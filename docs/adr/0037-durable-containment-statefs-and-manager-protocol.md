# ADR-0037: Durable containment statefs and manager protocol

- **Status**: Proposed
- **Date**: 2026-08-30
- Updated: 2026-09-05
- Deciders: Oxigraph parity programme
- Implementation status: implemented as a dormant, unregistered,
  authority-null candidate boundary and frozen for the S7 integrated review at
  base commit `4dbe7854a30ebe559cb918cf7cfe7780df3bc031`. The StateFS and
  manager-protocol modules, separately attested syscall translation unit, and
  all five owned evaluators are present. They confer no runtime registration,
  physical-host fact, qualification, readiness, promotion, or publication;
  production containment remains unavailable
- **Depends on**:
  [ADR-0035 — Durable native containment guardian and crash recovery](0035-durable-native-containment-guardian-and-recovery.md),
  [ADR-0036 — Guardian-control pure ABI](0036-guardian-control-pure-abi.md)
- **Related**:
  [ADR-0034 — First-class exact new-file admission](0034-first-class-exact-new-file-admission.md),
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md)

## Context

ADR-0035's journal-v2, lifetime-v1, and recovery-v1 values describe exact
ordering and relationships but deliberately prove no filesystem origin,
inventory, lock, durability, or mutation. A physical owner must preserve those
bytes while adding held-root access, exclusive writer ordering, write-once
records, crash-prefix recovery, and lifecycle moves. Combining that work with
native process and cgroup mechanics would make filesystem faults, process
faults, and semantic reducer faults difficult to distinguish.

## Decision

The completed local ADR-0036 C21 and programme-umbrella boundary at commit
`c01b3c6a59ec6c6ae24217e2eead7cff48c07cf7` satisfies this ADR's
documentation-only S0 predecessor gate. It does not change ADR-0036 from
Proposed, establish physical containment, or make readiness available. This S0
freezes the contracts below and changes no candidate source, evaluator,
registry, package, lock, runtime state, or external publication. This repository
artefact has no task-database authority and performs no task mutation;
separately authorized Ruflo orchestration records are out-of-band programme
evidence, not a product effect of this slice.
After independent acceptance it makes only ADR-0037 S1
`task-1788421823070-8gev0b` and S3 `task-1788421838794-f59hvu`
dependency-eligible; it starts neither.

Introduce two separately testable boundaries:

1. `containment-guardian-statefs-v1` owns held-descriptor filesystem inventory,
   immutable artifact persistence, lifecycle moves, and the only policy/oracle
   that may select a physical state-filesystem operation.
2. `containment-guardian-manager-protocol-v1` owns the finite manager/guardian
   writer handoff and selects only operations already authorized by complete,
   branded ADR-0035 lifetime and recovery boundaries.

The statefs boundary also owns one tiny, separately attested Linux x86-64
link-time C syscall translation unit. Its sole entrypoint is exactly
`oxigraph_containment_statefs_execute_v1(request, result)`. The request carries
only bounded held `dirfd` values, bounded literal names, bounded byte views, and
one of these eight operations:

- `LOCK_EX_NB`;
- `INVENTORY`;
- `PERSIST_NOREPLACE`;
- `MKDIR_SYNC`;
- `MOVE_NOREPLACE_SYNC`;
- `MOVE_SYNC_REOBSERVE`;
- `TEMP_CLEANUP`; or
- `RELEASE_DIRECTORY`.

The result reports the exact last completed step, failed step, `errno`, and
bounded current observation. It reports an honest syscall prefix; it never
selects policy, retries an ambiguous effect, or converts an error into durable
success. The translation unit accepts no root pathname, callback, process,
cgroup, provider, or fault-injection authority. Test builds may compile a
finite fault selector for the independently enumerated fault matrix, but that
selector is compiled out of every production object and executable.

Neither boundary changes the frozen journal, lifetime, or recovery schemas.
They consume exact bytes and same-origin selections from ADR-0035; they do not
reconstruct a selection from serialized lookalikes or digests.

### State filesystem

All access begins from the already-open owner-only state-root directory. No
caller path may select or replace it. The exclusive nonblocking `flock` remains
on the shared open file description and introduces no lock pathname. The root
inventory and lifecycle rules are exactly ADR-0035's
[six-directory grammar](0035-durable-native-containment-guardian-and-recovery.md#exact-pure-lifetime-ledger-v1-contract):
`lifetimes`, `staging`, `active`, `closed`, `recovered`, and `quarantined`, with
one full generation digest in at most one lifecycle directory. Unknown entries,
aliases, unsafe metadata, duplicate generations, symlink traversal, and residue
outside the bounded temporary-file grammar block before mutation.

Every immutable manifest, bundle, lifetime record, recovery record, or result
follows one physical sequence: create an exact private temporary regular file
without following a symlink, write and read back the complete bytes, sync the
file, install the final name without replacement, and sync the containing
directory before the governed effect. Directory creation and lifecycle moves
likewise sync the required source and destination parents in their ratified
order. Existing final names are verified, never overwritten or treated as
idempotent without exact byte equality and the applicable predecessor proof.

Attempt creation preserves ADR-0035's exact ordering: lifetime anchor durable,
attempt directory created, recovery parent synced, then record-1 temporary-file
persistence. Only the exact pre-temporary-file absent or present-empty outcomes
may become anchored-empty; residue cannot be laundered into an empty attempt.

### Manager protocol

The manager protocol consumes the external service-manager owner's fresh raw
actor epoch exactly once, binds its digest to the lifetime ledger before any
mutating effect, and keeps that stable manager actor, the admission guardian's
lifetime epoch, and every recovery actor distinct. It admits only the writer
transitions and crash
prefixes in ADR-0035's
[guardian-lifetime lineage](0035-durable-native-containment-guardian-and-recovery.md#guardian-lifetime-lineage).
It never infers guardian initialization, liveness, status, parentage, reap, or
cleanup from a PID, cgroup name, directory, or serialized ledger.

The protocol owns the deterministic response to lock contention, partial
launch, definite no-child launch failure, manager death, guardian death,
recovery-actor failure, fresh replan after a proved no-effect result, state-18
close, and proved reboot. A
replacement manager may request only a plan selected by complete lifetime and
recovery replay plus exact current inventory. The manager never mutates
generation `ctl` or `job` cgroups itself and never appends a guardian-only fact.

The statefs and manager outputs distinguish intended operation, completed local
syscall sequence, current observation, and unresolved outcome. An injected or
real failure leaves an honest prefix. No catch block converts an ambiguous
write, sync, rename, move, or directory-sync result into durable success.

The JavaScript statefs module remains the sole policy and evidence oracle. The
C translation unit is a bounded syscall executor beneath that oracle, not a
second state machine. ADR-0038 may link and attest the exact resulting object
unchanged; it may not copy, extend, reinterpret, or take ownership of its
request/result protocol or filesystem policy.

### Frozen predecessor and dependency surface

#### 2026-09-03 contract correction: exact recovery owner association

Before StateFS creates or reserves a plan token for recovery replan or
verification, it must obtain ADR-0035 recovery-v1's corrected owner-association
predecessor:

```text
selectCandidateContainmentRecoveryOwnerAssociationV1({
  target, lifecycleInventoryObservation, previousRecoveryReplay, plan, attempt
})
```

The selector requires exact module-local `WeakMap` brands and one same
target/inventory/replay/plan/nullable-attempt association. It rejects, before
token reservation, clones, cross-module values, mixed tuples, byte-equal
alternate replay anchors, and plan or attempt substitution. StateFS alone
invokes and retains that exact association. The manager may
consume only the existing branded StateFS handoff that binds the relationship;
it must neither invoke recovery-v1 nor reconstruct or substitute the
association with canonical bytes, a digest, a serialized projection, a fresh
replay, or a local owner check.

If the exact retained replay has no current anchor, the selector returns the
primitive `null`. Otherwise it is repeatable and returns a deeply frozen
null-prototype carrier with exactly `lifetimeAnchorProjection` and
`lifetimeAttemptAnchorRawSha256`: the first is strictly the exact current
anchor object retained for that replay and the second its retained paired
digest. It consumes, mints, or rebrands nothing; exposes no filesystem fact;
and leaves all authority, physical-fact, and nonclaim fields false/null.

This is the minimal predecessor repair for StateFS recovery replan and
verification. It supplies the missing exact current-anchor association while
leaving the frozen journal and lifetime bytes unchanged, allowing a fresh
inventory pass to remain tied to the existing replay rather than opening a
second same-byte identity channel. The recovery and guardian-control pins, and
the StateFS evaluator/requirements pin derived from them, must be superseded
before S2 resumes. It creates no filesystem request, manager decision, or
physical effect; the historical pins, receipts, statuses, and S0 evidence below
remain historical and are not recomputed, resealed, or rebaselined.

#### 2026-09-04 contract correction: total native observation evidence

The native observation ABI remains version 1, 384 bytes, and alignment 8, but
its zero-only uint32 field at offset 76 is corrected from `flags` to
`statx_mask`. Its exact JavaScript translation is `statxMask` in the matching
ordered position. Every published non-`ABSENT` observation requires
`(statxMask & 0x17ff) === 0x17ff`, where `0x17ff` is exactly
`STATX_BASIC_STATS|STATX_MNT_ID`; additional returned bits are permitted and
retained. A synthesized `ABSENT` observation instead has `statxMask === 0`
together with all existing zero-metadata constraints. `statxMask` exists only
in the private native executor/verifier observation shape; it is not added to a
public inventory projection or receipt digest.

The executor copies the kernel-returned `stx_mask` and validates the required
bits before interpreting any field that mask governs, publishing the current
observation, or incrementing `observation_count`. The current incomplete slot
remains zero. A terminating result retains exactly the earlier complete,
mask-validated, publishable observation prefix and no later or partial
observation. Publication is exhaustive: a mask failure while validating caller
descriptors at step 2 or 3, or the opened directory target at step 5, publishes
zero observations; every directory-entry slot remains provisional until step 6
completes, so a raw-representation or entry-mask failure there publishes only
the already valid target in slot zero; and a regular-file snapshot remains
provisional through step 7, so an initial or repeated `statx` mask failure
publishes zero observations. A mutation reobservation failure retains only
earlier canonical slots already completed by that sequence—for example, a
move's destination-mask failure may retain its already valid `ABSENT` source
slot—and never the failing destination. The JavaScript verifier independently
enforces the same rule: a purported
non-`ABSENT` observation without the complete required mask, an `ABSENT`
observation with a nonzero mask, or a result whose count includes an incomplete
slot is `STATEFS_RESULT`, not a semantic inventory rejection. Full mask coverage
is evidence only that the returned `statx` fields were marked available; it is
not cryptographic provenance, descriptor-origin evidence, or a replacement for
the existing identity and same-origin checks.

The native directory-entry output domain is the exact raw-byte range
`0x01` through `0x7f`, excluding `/`; `.` and `..` are recognized and discarded
and are never published. Other names in that range cross the ABI byte-for-byte.
In particular, control bytes `0x01` through `0x1f` and `DEL` (`0x7f`) are
representable and reach the JavaScript semantic inventory oracle, where they
are unsafe because they match no admitted grammar; the native decoder does not
silently omit or rewrite them. A payload byte at or above `0x80`, a name longer
than 255 bytes, an embedded `/`, or a malformed or unterminated
`linux_dirent64` record is unrepresentable output. Directory enumeration then
terminates at owning step `DIRECTORY_ENUMERATED` as
`REJECTED/NO_EFFECT`, with errno zero, the exact preceding dense step prefix,
the already validated target-directory observation as its complete target-only
observation prefix, and no partial entry. It is terminal `NO_RETRY` with no
successor token. A failed mandatory cleanup close may change only its effect to
`EFFECT_UNCERTAIN` under the descriptor-liveness rule below.

Every pre-mutation observation-mask, observed-metadata, or raw-representation
mismatch governed by this correction is `REJECTED/NO_EFFECT`, errno zero, at
its owning dense failed step; it retains only the preceding completed steps and
complete observations. Every corresponding post-mutation observation-mask or
observed-metadata mismatch is `VERIFICATION_FAILED` with errno zero and the
exact `MUTATION_OBSERVED_NOT_FULLY_SYNCED` or `EFFECT_UNCERTAIN` class fixed by
that mutation boundary. Every corrected `REJECTED/NO_EFFECT`, narrow
`REJECTED/EFFECT_UNCERTAIN`,
`VERIFICATION_FAILED/MUTATION_OBSERVED_NOT_FULLY_SYNCED`, and
`VERIFICATION_FAILED/EFFECT_UNCERTAIN` branch is terminal `NO_RETRY`,
fabricates no successor, and publishes no incomplete inventory. A complete,
mask-valid inventory that only the JavaScript semantic policy finds unsafe
retains its existing receipt-only `REJECTED/DEFINITE_NO_EFFECT` rule. All other
operation-specific status/effect rules, including the existing zero-read, EOF,
and length-mismatch rules, remain unchanged; in particular, an unrelated exact
`VERIFICATION_FAILED/DEFINITE_NO_EFFECT` result retains its existing
`REPLAN_AFTER_FRESH_INVENTORY` disposition rather than being widened into this
correction's terminal set.

Internal descriptor liveness starts when an `openat` succeeds, even if later
validation prevents `INTERNAL_DESCRIPTOR_OPENED` from becoming a completed
step. On failure cleanup, each actually acquired live internal descriptor is
closed once in reverse-open order and its integer is retired regardless of the
return. If and only if one of those cleanup closes fails, it upgrades a base
`NO_EFFECT`, `DEFINITE_NO_EFFECT`, or
`MUTATION_OBSERVED_NOT_FULLY_SYNCED` effect to `EFFECT_UNCERTAIN`; it does not
change the base status, first errno, failed step, completed prefix, bytes, or
validated observation prefix. Thus the otherwise forbidden
`REJECTED/EFFECT_UNCERTAIN` pair is accepted only at an exact post-open,
pre-mutation rejection boundary where an internal descriptor can be live. It
remains forbidden at every impossible-live boundary, and a successful cleanup
close leaves the base effect unchanged. No close is retried.

Every verified `EFFECT_UNCERTAIN` receipt, including that narrow rejected
case, has outcome `FAILED_EFFECT_UNCERTAIN`, disposition `NO_RETRY`, empty
`inventories`, and null successor token/digest. It grants no successor or
reusable capability, authority, or physical fact. These corrections supersede
the affected StateFS requirements, JavaScript evaluator, C ABI evaluator,
header/source, private fault evaluator, and attestation identities before
further integration. Prior green results remain historical evidence for their
exact earlier bytes and do not qualify the corrected contract. This amendment
changes no ADR status, implementation claim, authority, readiness, promotion,
publication, or protected runtime state.

The new modules may consume only these predecessor identities. A different
requirements digest, source specifier, export name, or same-byte value returned
by another module instance rejects before a statefs request or manager decision
exists.

| Predecessor                | Exact requirement or source identity                               |
| -------------------------- | ------------------------------------------------------------------ |
| `containment-exact-v2.mjs` | Git blob `8e59aae2ec200652ffa848c9d1a8ab31a2280c29`                |
| journal-v2                 | `95a4311224d8dfa5f481436e87da4b4d5f56a00d67278e7ed0e931476b584e26` |
| lifetime-v1                | `764975dd915913db4c4e0fc7bee308f8cb830c5f972ac0b97355601e7ff1b773` |
| recovery-v1                | `180ad61eba6cbc82d7828c881494dff23a030bdda953d98b8ea42fc88e145874` |
| guardian-control-v1        | `4306a64a108dd3537f5e6a6683f6615d59cab6e12d2c91ffbfb116a7439e9131` |

The exact source import inventories are below. Both arrays preserve module and
name order; no other static or dynamic import is permitted.

```text
statefsImportInventory = [
  [./containment-exact-v2.mjs,[sha256,nullRecord,deepFreeze,
    frozenCopyOnReadBytes,exactRecord,exactDenseArray,boundedInteger,
    exactBoolean,exactDigest,exactDecimal,exactUnicodeString,
    copyBoundedBuffer,decodeCanonicalJsonLine,canonicalJsonBytes]],
  [./containment-guardian-journal-v2.mjs,[
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_V2,
    verifyCandidateContainmentGuardianGenerationManifestV2,
    verifyCandidateContainmentGuardianJournalBundleV2,
    replayCandidateContainmentGuardianJournalV2]],
  [./containment-guardian-lifetime-v1.mjs,[
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_V1,
    replayCandidateContainmentGuardianLifetimeV1,
    selectCandidateContainmentGuardianLifetimeRecoveryTargetV1,
    selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1,
    selectCandidateContainmentGuardianLifetimeExternalHeadV1,
    selectCandidateContainmentGuardianLifetimeNormalCloseReceiptV1,
    assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1,
    assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1,
    assertCandidateContainmentGuardianLifetimeExternalHeadSelectionV1,
    assertCandidateContainmentGuardianLifetimeNormalCloseReceiptSelectionV1,
    assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1]],
  [./containment-guardian-recovery-v1.mjs,[
    CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_V1,
    verifyCandidateContainmentRecoveryTargetV1,
    verifyCandidateContainmentRecoveryInventoryObservationV1,
    replayCandidateContainmentRecoveryV1,
    selectCandidateContainmentRecoveryOwnerAssociationV1,
    verifyCandidateContainmentRecoveryAttemptV1,
    verifyCandidateContainmentRecoveryAnchoredEmptyAttemptV1,
    verifyCandidateContainmentRecoveryRecordV1]]
]
managerImportInventory = [
  [./containment-exact-v2.mjs,[sha256,nullRecord,deepFreeze,
    frozenCopyOnReadBytes,exactRecord,exactDenseArray,boundedInteger,
    exactBoolean,exactDigest,exactDecimal,exactUnicodeString,
    copyBoundedBuffer,decodeCanonicalJsonLine,canonicalJsonBytes]],
  [./containment-guardian-statefs-v1.mjs,[
    CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS,
    assertCandidateContainmentGuardianStatefsPlanV1,
    assertCandidateContainmentGuardianStatefsReceiptV1]],
  [./containment-guardian-control-v1.mjs,[
    CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS,
    createCandidateContainmentGuardianRecoveryRequestInputV1,
    verifyCandidateContainmentGuardianStatusFrameV1]]
]
```

The manager uses exactly `managerImportInventory`; each exact specifier occurs
once. Statefs alone imports and authenticates the journal, lifetime, and
recovery owner modules. Neither module
imports a guardian-control reducer/state, journal implementation helper,
syscall attestation module, filesystem/process/native-addon API, ADR-0038 code,
registry, readiness, network, timer, environment, callback, dependency
injection, or side-effect module. Neither re-exports a predecessor. An
implementation may not replace an owner check or statefs plan assertion with a
local copy even if one test path reaches only a subset.

ADR-0035 remains the sole owner of generation-manifest, journal-v2,
lifetime-v1, and recovery-v1 bytes and brands. ADR-0036 remains the sole owner
of guardian-control frames and reducer brands. This ADR validates complete
same-origin predecessor tuples in statefs and consumes only statefs's exact
privately branded plan/context handoff in manager; a digest, serialized projection, spread,
structured clone, or separately imported byte-equal value is not a substitute.

### Exact JavaScript statefs-v1 API

`containment-guardian-statefs-v1.mjs` has exactly seven named exports, no default
export, and no side-effect or namespace export:

```text
CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS
CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256
planCandidateContainmentGuardianStatefsOperationV1(input)
assertCandidateContainmentGuardianStatefsPlanV1(plan)
assertCandidateContainmentGuardianStatefsRequestV1(request)
verifyCandidateContainmentGuardianStatefsResultV1({ request, executorResult })
assertCandidateContainmentGuardianStatefsReceiptV1(receipt)
```

The requirements value is an exact recursively frozen null-prototype record
with these top-level fields in order:

```text
schema
version
predecessors
importInventory
schemas
limits
directoryRoles
rootDirectoryNames
nameGrammars
plannerKinds
operations
inventoryKinds
heldDirectoryObservationFields
inventoryEntryFields
inventoryObservationFields
inventorySetFields
directoryHandlePreimageFields
plannerInputFields
ownerContextFields
planFields
requestFields
nativeObservationFields
executorResultFields
receiptFields
operationSteps
operationStepSequences
executorResultStatuses
receiptStatuses
effectClasses
outcomes
retryDispositions
errorPrecedence
fdRules
metadataRules
syscallRules
orderingRules
privateFilesystemReportFields
privateFilesystemProfile
authority
physicalFacts
nonclaims
```

Its schema is
`oxigraph.candidate-containment-guardian-statefs-requirements/v1`, `version` is
the integer `1`, and `predecessors` contains the five identities in the table
above in that order. The exported requirements digest is the lowercase SHA-256
of repository-canonical JSON for that complete value without a trailing LF.
The S1 evaluator owns the independently reconstructed literal golden; the
candidate computes the digest from its own value and may not import evaluator
data.

The other exact schema literals are:

| Value                      | Schema                                                                          |
| -------------------------- | ------------------------------------------------------------------------------- |
| held-directory observation | `oxigraph.candidate-containment-guardian-statefs-held-directory-observation/v1` |
| inventory observation      | `oxigraph.candidate-containment-guardian-statefs-inventory-observation/v1`      |
| inventory-set token        | `oxigraph.candidate-containment-guardian-statefs-inventory-set/v1`              |
| directory-handle preimage  | `oxigraph.candidate-containment-guardian-statefs-directory-handle-preimage/v1`  |
| owner context              | `oxigraph.candidate-containment-guardian-statefs-owner-context/v1`              |
| statefs plan               | `oxigraph.candidate-containment-guardian-statefs-plan/v1`                       |
| operation request          | `oxigraph.candidate-containment-guardian-statefs-request/v1`                    |
| executor result            | `oxigraph.candidate-containment-guardian-statefs-executor-result/v1`            |
| verified receipt           | `oxigraph.candidate-containment-guardian-statefs-receipt/v1`                    |
| private-filesystem report  | `oxigraph.candidate-containment-guardian-statefs-private-filesystem-report/v1`  |

All integer-like filesystem identity values exposed to JavaScript are minimal
unsigned decimal strings, except bounded counts and byte lengths, which are
safe non-negative JavaScript integers. A digest is exactly 64 lowercase
hexadecimal characters. An absent optional field is the primitive `null`; an
empty string, zero digest, missing property, or `undefined` never substitutes
for null.

UID, GID, and native `statxMask` are integers from 0 through 4,294,967,295
before ABI conversion. Public JavaScript `mode` is exactly the four-ASCII-byte
permission string `0600` or `0700`; no other spelling or numeric substitute is
accepted.
The native observation's uint32 `mode` is the exact Linux `statx.stx_mode`.
Translation derives entry kind from `mode & 0170000`, requires the expected type
bits and zero setuid/setgid/sticky bits, and emits the zero-padded four-digit
string for `mode & 0777`. Device major/minor, inode, mount ID, link count, filesystem magic,
and native byte length are minimal unsigned decimal strings representing 0
through 18,446,744,073,709,551,615; required mount IDs and inodes are nonzero.
No JavaScript `Number` carries a 64-bit identity. An out-of-range or nonminimal
value is `STATEFS_BOUNDS` before metadata comparison.

The held-directory observation has exactly these ordered fields:

```text
schema
role
accessMode
closeOnExec
fileType
ownerUid
ownerGid
mode
linkCount
deviceMajor
deviceMinor
inode
mountId
filesystemMagic
identitySha256
authority
physicalFacts
nonclaims
```

`accessMode` is `O_RDONLY`, `fileType` is `DIRECTORY`, `mode` is the string
`0700`, and both `ownerUid` and `ownerGid` equal the effective owner and group
supplied by the native owner.
The inherited guardian `STATE_ROOT` observation repeats ADR-0036's
`closeOnExec: false`; every statefs-opened child directory observation has
`closeOnExec: true`. Directory link count is at least two. The complete set of
observed directory identities must contain no repeated `(deviceMajor,
deviceMinor,inode,mountId)` tuple across distinct canonical root-relative paths.
The parent-inventory entry and subsequently opened child observation for the
same canonical path must instead be exactly equal in identity, type, owner,
mode, and mount fields and count as one identity. Identity SHA-256 covers repository-canonical
JSON for every preceding field.

An inventory entry has exactly these ordered fields and is nested only inside
an inventory observation:

```text
name
kind
mode
ownerUid
ownerGid
linkCount
byteLength
deviceMajor
deviceMinor
inode
mountId
filesystemMagic
contentByteLength
contentRawSha256
```

Entry `kind` is exactly `REGULAR`, `DIRECTORY`, `SYMLINK`, `FIFO`,
`BLOCK_DEVICE`, `CHARACTER_DEVICE`, `SOCKET`, or `OTHER`; `REGULAR_FILE` is
instead the distinct operation-level `inventoryKind` that requests one named
entry's bytes. Content fields are non-null only in a successful
`INVENTORY/REGULAR_FILE` observation whose sole entry kind is `REGULAR`, and
otherwise both are null. Regular files must be mode `0600`, have owner UID and
GID equal to the expected effective UID and GID, have link count one, be on the
expected mount, and not exceed the applicable predecessor byte ceiling.
Directories must have the same expected owner UID and GID, mode `0700`, and the
expected mount. Every other kind, owner/group/mode mismatch, repeated
inode, mount drift, or unexpected link count is unsafe rather than ignored.

The inventory observation has exactly:

```text
schema
requestSha256
directory
directoryHandleSha256
inventoryKind
requestedName
entryCount
entries
contentBytes
inventorySha256
authority
physicalFacts
nonclaims
```

`directoryHandleSha256` is the opaque semantic key for the exact held directory
whose observation is in `directory`; it is not an FD number or descriptor fact.
For `DIRECTORY`, `requestedName` is null and entries are a dense array sorted by
unsigned ASCII name bytes, with no duplicate name or identity. For
`REGULAR_FILE`, `requestedName` is the exact requested component: a present
regular file has one `REGULAR` entry and an absent name has `entryCount: 0` and
`entries: []`. The native executor's one `ABSENT` observation is therefore a
wire-level result discriminator, not an inventory-entry kind; the JS verifier
translates it only to that zero-entry canonical observation. `contentBytes` is
null except for one present `REGULAR_FILE` entry, where it is a copy-on-read byte
view whose length and SHA-256 equal that entry.
`inventorySha256` is the SHA-256 of repository-canonical JSON for one exact
null-prototype projection with these ordered fields:

```text
schema
requestSha256
directory
directoryHandleSha256
inventoryKind
requestedName
entryCount
entries
contentByteLength
contentRawSha256
```

The first eight values are the identical public values. The last two replace
`contentBytes`: both are null when it is null, otherwise they are its exact safe
integer length and raw SHA-256. Public `inventorySha256`, `authority`,
`physicalFacts`, and `nonclaims` are absent from this digest projection rather
than reordered or replaced. `authority` and `physicalFacts` are the exact
all-false/null records defined below.
Every inventory observation returned inside a verified receipt is privately
branded by statefs; only that exact object may later occupy an inventory-set
token's private map.
A canonical lookalike or observation detached from its receipt association is
`STATEFS_BINDING`.

An inventory-set token is a nonserializable statefs capability with exactly
these ordered public fields:

```text
schema
requirementsSha256
managerActorEpochSha256
revision
previousInventorySetSha256
producingRequestSequence
producingRequestSha256
scopeCount
inventorySetSha256
authority
physicalFacts
nonclaims
```

Its private association owns an immutable complete map from canonical scope to
the exact branded inventory observation; that map is never exported. Scope is
the ordered tuple `directoryHandleSha256`, `inventoryKind`, and
`requestedName`. The map's canonical digest projection is a dense array sorted
by root-relative unsigned-ASCII component chain and then `inventoryKind` and
nullable requested-name bytes. Each element has exactly the ordered fields
`directoryHandleSha256`, `directoryIdentitySha256`, `inventoryKind`,
`requestedName`, and `inventorySha256`. `inventorySetSha256` is the SHA-256 of
repository-canonical JSON for that array. `scopeCount` is its length.

The first token is minted only by a complete `LOCK_HELD` receipt, has revision
zero, null predecessor, that lock request's sequence and digest, an empty
private map, scope count zero, and the digest of canonical `[]`. Every later
successor has revision exactly one greater, names the prior map digest, and
names its producing request. Statefs privately binds each token to exactly one
module instance, manager epoch, predecessor token, and immutable map. A spread,
structured clone, JSON parse, separately imported lookalike, same digest, or a
token from another epoch/module is never a capability.

`planCandidateContainmentGuardianStatefsOperationV1(input)` accepts one exact
own-data-property, non-accessor, non-Proxy record. It first copies all byte
views, validates raw count and byte bounds, re-verifies every complete
predecessor tuple with its owning module, and only then chooses an operation.
Its input has exactly these ordered fields:

```text
kind
managerActorEpochSha256
requestSequence
inventorySetSha256
stateRootObservation
currentInventorySet
unresolvedReceipt
generationManifest
normalJournalBundles
lifetimeReplayArguments
recoveryTarget
recoveryInventory
recoveryReplay
recoveryPlan
recoveryAttempt
recoveryRecord
artifactBytes
inventoryDirectoryRole
directoryRoleA
directoryRoleB
nameA
nameB
expectedOutcome
```

`kind` is exactly `LOCK_EX_NB`, `INVENTORY`, `RELEASE_DIRECTORY`, or `AUTO`.
The first three are manager traversal/lifecycle selectors; `AUTO` is mandatory
for every replay-derived mutation or context-only decision and statefs derives
the unique operation/disposition. Except for `currentInventorySet`,
fields irrelevant to that operation are exactly null; there is no permissive
options bag. `currentInventorySet` is null only for a lock request; every
inventory, release, observation-only, or mutating request uses the
exact latest unconsumed inventory-set token. Statefs obtains the zero through
two operation scopes from that token's private map in directory-role order A
then B; callers never choose or reorder observations. `requestSequence` is an integer from 0
through 999,999. `inventorySetSha256` is null before the first accepted
token and otherwise exactly equals `currentInventorySet.inventorySetSha256`.
Statefs validates and binds
only those literals and the literal `managerActorEpochSha256`; it neither authenticates an epoch digest
nor retains mutable per-digest sequence state. The manager protocol alone owns
the fresh same-origin epoch brand and enforces that each successfully planned
request uses its stable manager-actor digest and exactly the next sequence.
The statefs private associations require the token to come from the same module
instance and literal manager-actor digest and to precede the new sequence; the
manager independently proves that exact token identity is its latest accepted
inventory state with no intervening request. `lifetimeReplayArguments` has exactly the ordered keys
`segments`, `expectedStateRootIdentitySha256`,
`expectedLatestLifetimeEpochSha256`, `expectedLatestRecordSequence`, and
`expectedLatestRecordRawSha256`, with the exact values accepted by ADR-0035's
replay function. Statefs invokes that function itself and derives any required
target, attempt anchor, external head, close receipt, or boundary set through
the exact owner selector/assertion exports; it never accepts a replay output or
selected boundary from the caller. A persistence request includes exactly one verified
artifact byte view. A move request includes the complete branded durable
decision prefix and matching current inventory. A lock request has only the
manager-actor digest, sequence, and state-root observation non-null. The
planner-input `expectedOutcome` is exactly `LOCK_HELD` for `LOCK_EX_NB`,
`INVENTORY_OBSERVED` for `INVENTORY`, `DIRECTORY_RELEASED` for
`RELEASE_DIRECTORY`, and null for `AUTO`; these fixed values convey no caller
choice. For `AUTO`, statefs derives the nested request's or observation-only
receipt's unique expected outcome from the complete owner context and private
inventory scopes. An executing inventory request adds roles and names but no artifact
or recovery values; root uses an empty inventory array and every child/file
form carries its exact parent observation as frozen below.

The sole target-free bootstrap is literally `segments: []`, a non-null expected
state-root identity, and three null expected-tail fields. The internally invoked
ADR-0035 replay must return `NO_LIFETIME_RECORD`; it may select only the normal
genesis `NEXT_RECORD` relationship and no target, boundary, move, cleanup,
guardian, or recovery action. Every other action requires a nonempty internally
produced replay with the exact externally anchored tail and applicable owner
selector/assertion. This ADR does not invent a generic replay assertion export
that ADR-0035 does not provide.

`unresolvedReceipt` is either null or, only while the originating module process
still exists, the exact private-branded incomplete receipt from that request.
Statefs then requires its request association, durable authorization digest,
names, roles, artifact digest, and observed prefix to match the current
inventories. Process loss necessarily makes this field null. Crash restoration
instead requires the complete same-origin ADR-0035 intent, move decision, or
cleanup authorization already carried by the applicable replay/boundary input
plus a complete fresh inventory; a digest or caller-selected prefix
discriminator is insufficient in either path.

Private inventory lookup by requested `kind` is exact: lock uses no token; a
root-directory inventory replaces the complete prior map (if any);
nested-directory and regular-file inventory each use the single exact
parent-directory inventory observation whose private association owns the held
handle; persistence uses
`[DIRECTORY(directoryRoleA), REGULAR_FILE(directoryRoleA,nameB)]`; mkdir uses
`[DIRECTORY(directoryRoleA)]`; both move operations use
`[DIRECTORY(directoryRoleA), DIRECTORY(directoryRoleB)]`; cleanup uses
`[REGULAR_FILE(directoryRoleA,nameA)]`; release uses the singleton exact
nonroot `DIRECTORY(directoryRoleA)` observation whose held handle is at the top of
the manager's private DFS stack. A root-directory inventory request has
`inventoryDirectoryRole: STATE_ROOT`, `directoryRoleA: STATE_ROOT`, and null
`directoryRoleB`, `nameA`, and `nameB`. A nested-directory inventory request has
the held parent in role A, its child component in `nameA`, the child's semantic
role in `inventoryDirectoryRole`, and null role B/name B. A regular-file
inventory request has null `inventoryDirectoryRole`, non-null `directoryRoleA`
and `nameA`, and null `directoryRoleB` and `nameB`. Persistence groups the parent-directory
observation first and the final-file observation second even when the latter
observes absence. No observation can fill two positions or be silently
reordered. A missing, duplicate, stale, or differently branded scope is
`STATEFS_BINDING` before a request exists.

`RELEASE_DIRECTORY` always has `executionDisposition: EXECUTE`, expected outcome
`DIRECTORY_RELEASED`, the one nonroot role/identity/handle in A, and every name,
role B, artifact, owner-replay, recovery, and unresolved-receipt field null. It
is selected only by the manager's private top-of-stack relationship and never
by a caller-supplied handle digest.

For an auto-selected mutating operation, the complete owner context and private
scopes derive the unique `expectedOutcome` and select exactly one of two
planner dispositions. An exact absent destination plus its required present
source, if any, selects `EXECUTE` and the created/moved/removed outcome. An
exact present final file with identical bytes and an owner replay already
containing that exact final raw head, an exact present child identity with its
durable owner observation, an exact destination generation identity/source
absence with a complete durable location receipt, or an exact absent temporary
with a complete tail-matched owner replay containing the exact durable final
artifact and proving no current writer can own the paired temporary name
selects `OBSERVATION_ONLY` and,
respectively, `ALREADY_PRESENT_EXACT`,
`DIRECTORY_ALREADY_PRESENT_EXACT`,
`DESTINATION_ALREADY_PRESENT_EXACT`, or `TEMP_ALREADY_ABSENT`. Every mismatch,
unsafe entry, unresolved temporary, source/destination collision, stale or
wrong-role receipt, and every other outcome/disposition combination is
`STATEFS_TRANSITION`. Observation-only selection never emits a C request and
never treats an `EEXIST` or `ENOENT` from a mutating call as success.

Those four owner facts are the complete already-completed prefix
discriminators. If a final,
child, destination, or absence is merely observed after an incomplete request,
it cannot select an `*_ALREADY_*` outcome. A matching incomplete pre-rename move
with source present replans the original no-replace move only after a
definite-no-effect receipt. A crash-restored durable move decision with a
complete fresh inventory showing source absent and the exact destination
identity, but no durable completed-move outcome, selects only
`MOVE_SYNC_REOBSERVE`; a surviving exact incomplete receipt is an additional
binding when available, never a recovery prerequisite. An ambiguous rename,
changed identity, both names, or neither name is `STATEFS_TRANSITION`.
Temporary presence selects cleanup only when that same complete owner replay
contains the exact final artifact, binds the deterministic temporary name to
that final artifact's request authorization, and proves no current writer can
own it. Temporary absence without that owner replay and complete fresh inventory
remains unresolved; no process-local receipt/token stands in for crash-durable
proof. These rules never infer historical durability from current
namespace state: sync/reobserve is a new bounded current operation, not proof
that a prior rename was durable.

The planner returns a statefs plan, never a bare request. Its exact ordered
public fields are:

```text
request
ownerContext
inventorySet
schema
requirementsSha256
managerActorEpochSha256
requestSequence
inventorySetSha256
planKind
managerDisposition
operation
writerKind
actorKind
targetSha256
requiredDurableRecordType
requiredOutcomeRecordType
guardianAction
requestSha256
ownerContextSha256
planSha256
authority
physicalFacts
nonclaims
```

`planKind` is `REQUEST` or `CONTEXT_ONLY`. `managerDisposition` is exactly
`STATEFS_REQUEST`, `GUARDIAN_HANDOFF`, `WAIT_GUARDIAN`, `RECOVERY_REPLAN`, or
`TERMINAL`. `REQUEST` pairs only with `STATEFS_REQUEST`, a non-null exact
request, and that request's operation/digest; all other dispositions pair only
with `CONTEXT_ONLY` and null operation/request fields. `inventorySet` is the
exact input token and `inventorySetSha256` its digest; lock alone has both null.
For both plan kinds, `requestSequence` is the exact planner-input value. A
request-bearing plan binds that value to its nested request. A context-only
plan reserves neither the value nor the token: the manager must require the
value to equal its current `nextStatefsRequestSequence`, does not increment it,
and rejects that plan after any intervening accepted plan or state transition.
The six writer/actor/target/record/action fields are the one exact relationship
derived from the branded owner context, with nullability fixed by that
relationship. For a request plan they equal the nested request; for a context
plan they are the only public description the manager may copy after the
statefs plan assertion returns that exact privately associated context.
`planSha256` covers every non-capability field in printed order except itself.
The canonical projection omits `request`, `ownerContext`, and `inventorySet`,
binding them only by their three digests. A serialized projection, digest, or
reconstructed nested object is not a plan.

The plan's `ownerContext` is an authority-null statefs capability with exactly:

```text
schema
lifetimeReplay
recoveryTarget
recoveryInventory
recoveryReplay
recoveryPlan
recoveryAttempt
recoveryRecord
lifetimeAnchorProjection
lifetimeAttemptAnchorRawSha256
generationManifest
normalJournalBundles
ownerContextSha256
authority
physicalFacts
nonclaims
```

Its schema is `oxigraph.candidate-containment-guardian-statefs-owner-context/v1`.
Each value is null, the exact same-origin owner value, or—in the one plural
field—the exact dense frozen array of owner values. Statefs derives the lifetime
replay and anchor selection internally; it does not accept either as a caller
projection. `ownerContextSha256` hashes a canonical projection containing, in
this exact field order:

```text
schema
lifetimeReplaySha256
recoveryTargetSha256
recoveryInventorySha256
recoveryReplaySha256
recoveryPlanSha256
recoveryAttemptSha256
recoveryRecordRawSha256
lifetimeAnchorProjectionSha256
lifetimeAttemptAnchorRawSha256
generationManifestRawSha256
normalJournalBundleRawSha256s
```

The schema is the public schema. Each singular digest is null with its
capability or is, respectively, the SHA-256 of the complete owner-defined
canonical replay/target/inventory/replay/plan/attempt/lifetime-anchor projection
or the owner's exact raw record/manifest bytes. The final value is a dense array
of exact raw bundle digests in public bundle order. Public
`ownerContextSha256`, `authority`, `physicalFacts`, and `nonclaims` are absent
from this digest projection. The capability itself is privately
bound to those exact objects and the plan; its digest authenticates no
replacement.

Statefs derives exactly one manager disposition after complete owner replay and
inventory checks. A unique physical or observation-only action creates a
`REQUEST` plan. An exact guardian transfer, wait prefix, replan prefix, or
terminal tail creates the corresponding `CONTEXT_ONLY` plan. Zero or multiple
relationships are `STATEFS_TRANSITION`; `AUTO` cannot force a disposition or
operation. The manager consumes this branded result before learning or acting
on the selected relationship; it never reads statefs lexical metadata or
duplicates the statefs filesystem oracle.

The module owns a private `WeakMap` from plan to its exact context, request,
token, epoch, and digest projection. For a request plan, request creation
atomically reserves the predecessor inventory token to that plan; a context-only
plan does not reserve or mutate it. `assertCandidateContainmentGuardianStatefsPlanV1(plan)`
accepts one exact unhanded-off plan, marks only that plan handed off, and returns
its exact `ownerContext` capability. It returns neither primitive true nor a
copy. The manager input constructor performs every own validation first, calls
this assertion as its final fallible step, and immediately commits its private
input association; thus a failed manager validation does not consume a plan.
A second assertion, cross-module/epoch plan, spread, clone, serialized
projection, or byte-equal replacement throws `STATEFS_BINDING`.

The operation request nested in a request plan is a private-branded,
recursively frozen null-prototype value with exactly these public fields:

```text
bytes
inventorySet
schema
requirementsSha256
managerActorEpochSha256
requestSequence
inventorySetSha256
requestSha256
operation
executionDisposition
writerKind
actorKind
targetSha256
requiredDurableRecordType
requiredOutcomeRecordType
inventoryKind
inventoryDirectoryRole
directoryRoleA
directoryIdentitySha256A
directoryHandleSha256A
directoryRoleB
directoryIdentitySha256B
directoryHandleSha256B
nameA
nameB
inputByteLength
inputRawSha256
temporaryIdentitySha256
authorizationRawSha256
unresolvedReceiptSha256
expectedOutcome
authority
physicalFacts
nonclaims
```

`bytes` is a copy-on-read view of the input artifact or null. `inventorySet` is
the exact token supplied to the planner, or null only for lock. Every root
inventory consumes the token minted by its accepted lock receipt. The canonical request projection excludes both capability fields;
it binds bytes by length/digest and the token by `inventorySetSha256` instead.
`executionDisposition` is exactly `EXECUTE` or `OBSERVATION_ONLY`; its closed
semantics are frozen below. The writer, actor, target, durable-predecessor type,
and outcome-record type are exact values derived from the complete same-origin
ADR-0035/recovery inputs; nullable values follow the predecessor tables and are
never caller-selected. `requestSha256` is the repository-canonical SHA-256 of a
projection containing every non-capability public request field in the printed
order except `requestSha256`; the retained `inputByteLength`,
`inputRawSha256`, and `inventorySetSha256` bind the omitted capability values.
`temporaryIdentitySha256`
is non-null only for an
executing `PERSIST_NOREPLACE` request and equals the SHA-256 of canonical JSON
for `{managerActorEpochSha256, authorizationRawSha256, operation, nameB,
inputRawSha256}` in that exact key order. The same unresolved immutable intent
therefore selects the same recoverable temporary name across an inner-manager
restart; an unrelated intent cannot collide merely because an in-memory
sequence restarted. `unresolvedReceiptSha256` is null unless the corresponding
same-process planner input is non-null, when it is that exact receipt's digest;
it is necessarily null on the crash-restored durable-intent path.
`authorizationRawSha256` is
required for every mutating request. For persistence it is the exact admitted
predecessor raw head, or the all-zero genesis head when the owning reducer
admits a genesis record. For a directory creation, lifecycle move, or cleanup it
is the exact complete ADR-0035 anchor, intent, decision, or unresolved-request
record that precedes the operation. Lock and inventory have it null. The
private request association retains the complete owner-module value, so the raw
digest alone grants nothing. Every request remains authority-null and proves no
descriptor or filesystem fact.

A directory handle is a semantic, same-manager lookup key, never an FD value.
The root handle is the SHA-256 of canonical JSON with ordered fields `schema`,
`managerActorEpochSha256`, `role`, `identitySha256`,
`parentDirectoryHandleSha256`, and `name`, where schema is
`oxigraph.candidate-containment-guardian-statefs-directory-handle-preimage/v1`,
role is `STATE_ROOT`, and the last two fields are null. A child handle hashes
the same fields with the exact child role and identity, its parent handle, and
ASCII component name. Request handle/identity pairs come only from the copied
root observation or an exact prior branded directory-inventory observation in
the consumed inventory-set token. A
handle is valid only within that manager actor epoch and statefs module
instance; it cannot be reconstructed from a digest to obtain an FD.

The executor-result input has exactly these ordered fields:

```text
schema
abiVersion
requestSha256
operation
status
effectClass
lastCompletedStep
failedStep
errno
completedStepCount
bytesConsumed
observations
outputBytes
returnedDirectoryFd
```

It is a reported translation of the C result and observation buffers. `errno`
is the integer zero unless status is `SYSCALL_FAILED` or `FAULT_INJECTED`, when
it is from 1 through 4095; `VERIFICATION_FAILED` always has errno zero.
`outputBytes` is copied before parsing and is null
outside regular-file inventory. Counts, step sequence, operation, and all
observation metadata must agree with the request and the frozen C ABI.
`returnedDirectoryFd` is `-1` except in exactly two nested-directory inventory
prefixes: a successful complete result, or `FAULT_INJECTED` immediately after
final step `DIRECTORY_HANDLE_TRANSFERRED`. In either case it is the exact
nonnegative provisional descriptor returned by C; the complete receipt path
may install it, while the after-final fault path must close it once and never
install it. It is consumed by the ADR-0038 adapter and never appears in a
receipt or canonical digest. A before-step-32 fault still reports `-1` because
the executor retains and cleanup-closes its internal descriptor.

Each `observations` element is an exact null-prototype translation with ordered
fields `kind`, `role`, `name`, `deviceMajor`, `deviceMinor`, `inode`, `mountId`,
`byteLength`, `linkCount`, `mode`, `ownerUid`, `ownerGid`, `statxMask`,
`filesystemMagic`, `contentOffset`, and `contentLength`; the array length equals
the C result's `observation_count`. Integer and decimal-string translation
follows the frozen JS/ABI rules. `statxMask` is the exact native uint32 value,
and zero reserved bytes are rechecked. Directory
inventory has the target held-directory observation first and zero through 256
entry observations thereafter. Present regular-file inventory has one
`REGULAR` observation with exact requested name and output extent. Absent
regular-file inventory has exactly one `ABSENT` observation whose role/name are
the exact request, whose every identity/metadata/content field, including
`statxMask`, is zero, and whose output is empty; only the verifier turns it into
the canonical zero-entry inventory. Every other observation requires
`(statxMask & 0x17ff) === 0x17ff`; extra mask bits are retained. Complete
persistence has the one final `REGULAR` observation and C has already
byte-compared it to the request input. Complete mkdir has the one new
`DIRECTORY` observation. Complete move or sync/reobserve has, in order, one
zero-metadata `ABSENT` source observation and the exact destination `DIRECTORY`
observation. Complete cleanup has one zero-metadata `ABSENT` temporary
observation. Complete release has no observation. Every operation-specific
observation count, role, name, mask, identity, content extent, and ordering is
exact; missing, extra, reordered, partially published, or mask-incomplete
observations are `STATEFS_RESULT`.

Planning is the token's atomic use point. After all validation and policy
selection succeeds but before returning a request, statefs irreversibly marks
the exact current token reserved to that one request. No second planning call
may use it, including a call for a byte-identical operation; a validation or
selection failure before request creation reserves nothing. Lock has no
predecessor token and is instead serialized only by the manager
epoch/request gate; every root inventory follows a complete lock receipt and
consumes its token.

`assertCandidateContainmentGuardianStatefsRequestV1` accepts only an exact
planned request held in this module instance's private request map, atomically
marks it `DISPATCHED`, and returns primitive `true`; every other value throws
`STATEFS_BINDING`. A second assertion or direct result verification of an
unasserted request rejects. `verifyCandidateContainmentGuardianStatefsResultV1`
requires the exact branded `DISPATCHED` request object returned by the planner.
After that dispatch-brand check and before inspecting any executor-result
property, it irreversibly marks the request `CONSUMED` and consumes its reserved
predecessor token. It
rejects replay, cross-request,
cross-manager, spread, serialized, separately imported, or byte-equal
lookalikes. It returns a recursively frozen null-prototype receipt with exactly:

```text
request
previousInventorySet
inventorySet
schema
requirementsSha256
requestSha256
operation
executionDisposition
writerKind
actorKind
targetSha256
requiredDurableRecordType
requiredOutcomeRecordType
previousInventorySetSha256
inventorySetSha256
status
effectClass
lastCompletedStep
failedStep
errno
completedStepCount
bytesConsumed
outcome
retryDisposition
inventories
receiptSha256
authority
physicalFacts
nonclaims
```

`request` is the exact consumed request object. `previousInventorySet` is its
exact `inventorySet` capability; `previousInventorySetSha256` is the same
nullable digest bound by that request. `inventorySet` is the exact newly minted
successor token and `inventorySetSha256` is its map digest, or both are null on
a result that requires fresh inventory or terminal handling. These three
capability slots are never copied into canonical evidence. The receipt's
canonical digest projection omits the first three capability fields rather
than replacing them, because their exact bindings already occur once in the
later `requestSha256`, `previousInventorySetSha256`, and
`inventorySetSha256` fields.

For `EXECUTE`, `executorResult` must be the exact non-null executor-result shape.
For `OBSERVATION_ONLY`, it must be primitive null; the returned receipt has
status `OBSERVATION_ONLY`, effect class `DEFINITE_NO_EFFECT`, step fields
`NONE`, errno and counts zero, `inventories` equal the exact branded input
observations needed by that no-effect decision, and the one exact already-observed
outcome retained by the request. No other null result is accepted.
It mints a successor token with the unchanged map and next revision so the
prior token cannot be replayed.
The five writer/actor/target/record fields are copied unchanged from the
privately associated request and remain nullable exactly as in that request;
executor output cannot supply or alter them.
An ABI-valid `COMPLETE/COMPLETE` directory or regular-file inventory whose
copied entries are well-shaped but violate this ADR's name, expected-child,
owner, mode, link, type, mount, duplicate-identity, residue, or replay-admission
policy produces one evidence-only branded inventory observation but does not
install it. Its receipt is exactly
`REJECTED/DEFINITE_NO_EFFECT/REJECTED`, has errno zero, preserves the executor's
complete step/count/byte fields, uses `NO_RETRY`, exposes that singleton through
`inventories`, and has null successor token/digest. An ABI-inconsistent,
malformed, over-count, impossible-step, or mismatched executor result instead
throws `STATEFS_RESULT`, returns no receipt, and cannot enter the manager table.
An executor-reported `LIMIT_EXCEEDED` preserves its native `NO_EFFECT` or
`DEFINITE_NO_EFFECT` class, has outcome `REJECTED`, `NO_RETRY`, empty
inventories, and null successor; it is never rewritten to the
semantic-rejection status.
For a successful inventory operation, `inventories` is the singleton newly
verified observation. For `PERSIST_NOREPLACE`, `MKDIR_SYNC`,
`MOVE_NOREPLACE_SYNC`, `MOVE_SYNC_REOBSERVE`, and `TEMP_CLEANUP` complete
success, statefs deterministically applies the exact C observations to its
branded input observations and returns, respectively, `[updated parent,
present final]`, `[updated parent, new child]`, `[updated source parent, updated
destination parent]`, the same two currently reobserved parents, or `[updated
parent, absent temporary]`. Each element is a newly branded complete canonical
inventory observation. Except for the evidence-only semantic-rejection branch
above, lock, release, rejected, definite-no-effect, mutation-incomplete, and
effect-uncertain receipts use `[]`; those paths cannot manufacture changed-scope
observations. `LOCK_HELD` mints the empty
revision-zero token. Complete inventory and complete mutation receipts mint the
one exact successor token whose private map is, respectively, root-reset/scope
replacement or the printed post-state delta. Complete release mints a successor
with the unchanged map. A non-lock definite-no-effect result mints an
unchanged-map successor if and only if its exact retry disposition is
`REPLAN_AFTER_FRESH_INVENTORY`. Every no-retry failure—including semantic
rejection, executor rejection, limit exhaustion, lock contention,
mutation-incomplete, effect-uncertain, or otherwise unverifiable output—returns
no successor token; recovery then requires a new
manager protocol instance, a new accepted lock receipt, and complete fresh
inventory. A
verifier exception likewise returns no receipt or successor and the reserved
predecessor remains unusable.
`receiptSha256` is the SHA-256 of repository-canonical JSON for an exact
null-prototype projection whose ordered keys are the public keys from `schema`
through `inventories`, excluding only `receiptSha256`; its `inventories` value
is a dense array of each public inventory object's `inventorySha256` in the
same order rather than the objects or copy-on-read bytes. Thus request and each
token digest occur exactly once. The later public `authority`, `physicalFacts`,
and `nonclaims` fields are absent from this projection. The module owns a
private `WeakMap` from every request to its copied input and complete
same-origin predecessor tuple, and a second private association from each
receipt to that request. No public digest authenticates a replacement object.
`assertCandidateContainmentGuardianStatefsReceiptV1` analogously returns true
only for the exact receipt in that second association; it never accepts a
digest or reconstructed projection.

The successor-map transform is literal and has no implementation-selected
merge. Root directory inventory replaces the entire prior map with its one
directory scope. Child-directory or regular-file inventory replaces exactly
its named scope and leaves every other scope byte-identical. Complete
persistence replaces the parent-directory scope after inserting the verified
final entry in unsigned-ASCII order and replaces the final-file scope with a
present observation whose copied content bytes are the request bytes. Complete
mkdir replaces the parent scope after the same ordered insertion and inserts an
empty child-directory scope. Complete move removes the exact source entry from
the source-parent scope, inserts the observed same-identity destination entry
in the destination-parent scope, and deletes every now-stale descendant scope
under the source handle; sync/reobserve performs the same transform from the
fresh pre-sync source/destination observations. Complete cleanup removes the
temporary entry from its parent scope and replaces the temporary-file scope
with the canonical absent observation. Observation-only and release preserve
the map exactly while advancing only token identity/revision. Every changed or
inserted observation binds the producing request digest; every untouched
observation remains the exact same branded object. A missing expected entry,
unexpected pre-state, duplicate scope, digest mismatch, nonlocal delta, or
transform whose resulting scope count exceeds 221,959 is `STATEFS_RESULT` and
produces no successor token.

### Exact bounds, roles, names, and errors

The numeric limits are exactly:

| Limit                                       |     Value |
| ------------------------------------------- | --------: |
| raw manager epoch bytes                     |        32 |
| descriptors in one C request                |         2 |
| held directory descriptors                  |         5 |
| total statefs descriptors during one C call |         8 |
| request sequence maximum                    |   999,999 |
| component-name bytes                        |       255 |
| immutable artifact bytes                    |    98,304 |
| regular-file observation bytes              |    98,304 |
| entries in one directory observation        |       256 |
| aggregate root/lifecycle entries            |     1,536 |
| inventory-set scopes                        |   221,959 |
| observations in one C call                  |       257 |
| completed operation steps in one result     |        15 |
| operation-step numeric maximum              |        34 |
| canonical statefs request bytes             |   262,144 |
| canonical inventory or receipt bytes        | 1,048,576 |
| consecutive `EINTR` read/write retries      |         8 |
| inventory requests in one manager traversal |   250,000 |

The 98,304-byte ceiling preserves journal-v2's 96-KiB bundle maximum; smaller
predecessor-specific 16-KiB and 64-KiB ceilings continue to dominate their
values. Counts and byte lengths are checked before property traversal, UTF-8 or
JSON decoding, hashing, sorting, allocation proportional to caller input, or
predecessor verification.

The maximum complete traversal is 221,959 calls: 9,223 directory calls
(`1 + 6 + 256 + 1,280 + 2,560 + 5,120`) plus 212,736 regular-file calls
(`65,536 + 1,280 + 23,040 + 122,880`). The 250,000 traversal ceiling therefore
has 28,041 calls of headroom. The conservative whole-manager request bound is
689,440: one lock; 221,959 initial inventory calls; 9,222 initial directory
releases; 9,222 child opens and 9,222 releases in the single mutation pass;
212,736 immutable-file persists; 9,222 child-directory creates; 2,560 lifecycle
moves; one 2,560-call sync/reobserve allowance; and one 212,736-call
temporary-cleanup allowance. Thus the reachable request indices end at 689,439,
below the frozen unsigned
32-bit-compatible maximum 999,999. The manager rejects a 1,000,001st request
before input branding with `MANAGER_BOUNDS`; neither JS nor the uint32 C
contract permits wrap or truncation.

Directory roles, in order, are exactly:

```text
STATE_ROOT
LIFETIMES
LIFETIME_SEGMENT
STAGING
ACTIVE
CLOSED
RECOVERED
QUARANTINED
GENERATION
NORMAL_JOURNAL
RECOVERY_JOURNAL
RECOVERY_ATTEMPT
```

The state root contains exactly six entries named `lifetimes`, `staging`,
`active`, `closed`, `recovered`, and `quarantined`, each an owner-mode `0700`
directory on the root mount. `lifetimes/` contains at most 256 segment
directories named by full lifetime `identitySha256`; each contains only the
corresponding lifetime records. Each of the other five lifecycle directories
contains at most 256 generation directories named by full generation-identity
digest. One digest is present in at most one lifecycle directory.

A generation directory contains exactly owner-mode `0700` directories
`normal/` and `recovery/` plus owner-mode `0600` `generation.jsonl`. `normal/`
contains zero through 18 journal-v2 final files. `recovery/` contains zero
through four attempt directories named by the recovery-actor digest; each
attempt directory contains zero through 24 recovery-v1 final files. A lifetime
segment contains zero through 256 lifetime-v1 final files. These predecessor
ceilings dominate the generic directory-entry ceiling.

Every published name is a nonempty raw byte sequence whose bytes are in
`0x01` through `0x7f`, contains no `/`, and is neither `.` nor `..`. It crosses
the native/JavaScript boundary byte-for-byte; control bytes and `0x7f` are not
decoder errors. Unicode normalization, platform collation, percent decoding,
case folding, backslash-as-separator, and pathname expansion are forbidden. The
exact semantic grammar alternatives are:

```text
digest-directory = [0-9a-f]{64}
final-record = [0-9]{16}-[0-9a-f]{64}\.jsonl
generation-manifest = generation\.jsonl
fixed-directory = lifetimes|staging|active|closed|recovered|quarantined|normal|recovery
temporary-file = \.(generation\.jsonl|[0-9]{16}-[0-9a-f]{64}\.jsonl)\.tmp-[0-9a-f]{64}
```

The temporary suffix is the request's `temporaryIdentitySha256`. A temporary
name is permitted only as the exact in-progress or crash-prefix name paired
with its intended final name. It is never a final artifact, attempt directory,
generation directory, or evidence of absence. Any unmatched temporary file is
unsafe residue. Symlinks, hard-linked regular files, devices, FIFOs, sockets,
sparse or over-count directories, unknown names, aliases, duplicate identities,
wrong owners/modes/mounts, and any grammar-valid entry not admitted by complete
replay fail before mutation.

An observed raw name that does not fit the published domain is never truncated,
escaped, replaced, or silently omitted from a successful inventory. Instead, a
byte at or above `0x80`, more than 255 name bytes, an embedded `/`, or a
malformed/unterminated raw directory record ends the directory result at step
`DIRECTORY_ENUMERATED` with the complete validated target-only observation
prefix and no partial entry, under the exact status/effect and cleanup rules
below. The literal `.` and `..` records alone are discarded during enumeration.
A published control-byte or `0x7f` name is then an ordinary ABI-valid but
semantically unsafe inventory entry because it matches none of the alternatives
above.

The complete JavaScript error vocabulary and precedence are exactly:

```text
STATEFS_BOUNDS
STATEFS_SHAPE
STATEFS_GRAMMAR
STATEFS_PREDECESSOR
STATEFS_BINDING
STATEFS_REQUEST
STATEFS_RESULT
STATEFS_TRANSITION
```

Every thrown error message is exactly one code with no dynamic detail. The
precedence is the order above, skipping a category irrelevant to the call.
Bounds precede all property traversal. Shape covers prototypes, descriptors,
accessors, sparse arrays, byte-view brands, and canonical encodings. Grammar
covers names, roles, metadata and inventory cardinality. Predecessor covers an
invalid or incomplete owner-module value. Binding covers correct individual
values from different origins, requests, managers, or replays. Request covers
an unauthorized operation/field combination. Result covers impossible ABI,
step, errno, observation, or byte combinations. Transition covers an otherwise
valid action that is stale, replayed, reordered, post-terminal, or inconsistent
with the durable prefix.

All caller byte views are copied before validation and again on read. Returned
records and arrays are recursive null-prototype frozen values. Inputs must have
only exact own enumerable data properties; accessors, inherited keys, symbol
keys, extra/missing keys, Proxies that cannot sustain the complete descriptor
audit, mutable aliases, resizable/shared/detached buffers, sparse arrays, and
post-copy mutation reject or cannot affect the result.

#### Exact statefs requirements encoding

The independently reconstructed requirements value uses ordered
null-prototype records and dense arrays throughout. In addition to the exact
field arrays, enums, numbers, and digests already printed above, its nested
values are literally:

```text
predecessors = [
  [containmentExactV2GitBlob,8e59aae2ec200652ffa848c9d1a8ab31a2280c29],
  [journalV2RequirementsSha256,95a4311224d8dfa5f481436e87da4b4d5f56a00d67278e7ed0e931476b584e26],
  [lifetimeV1RequirementsSha256,764975dd915913db4c4e0fc7bee308f8cb830c5f972ac0b97355601e7ff1b773],
  [recoveryV1RequirementsSha256,180ad61eba6cbc82d7828c881494dff23a030bdda953d98b8ea42fc88e145874],
  [guardianControlV1RequirementsSha256,4306a64a108dd3537f5e6a6683f6615d59cab6e12d2c91ffbfb116a7439e9131]
]
importInventory = statefsImportInventory
schemas = [
  [requirements,oxigraph.candidate-containment-guardian-statefs-requirements/v1],
  [heldDirectoryObservation,oxigraph.candidate-containment-guardian-statefs-held-directory-observation/v1],
  [inventoryObservation,oxigraph.candidate-containment-guardian-statefs-inventory-observation/v1],
  [inventorySet,oxigraph.candidate-containment-guardian-statefs-inventory-set/v1],
  [directoryHandlePreimage,oxigraph.candidate-containment-guardian-statefs-directory-handle-preimage/v1],
  [ownerContext,oxigraph.candidate-containment-guardian-statefs-owner-context/v1],
  [plan,oxigraph.candidate-containment-guardian-statefs-plan/v1],
  [request,oxigraph.candidate-containment-guardian-statefs-request/v1],
  [executorResult,oxigraph.candidate-containment-guardian-statefs-executor-result/v1],
  [receipt,oxigraph.candidate-containment-guardian-statefs-receipt/v1],
  [privateFilesystemReport,oxigraph.candidate-containment-guardian-statefs-private-filesystem-report/v1]
]
limits = [
  [managerActorEpochBytes,32], [descriptorCount,2],
  [heldDirectoryDescriptorCount,5], [totalStatefsDescriptorCount,8],
  [requestSequenceMaximum,999999], [componentNameBytes,255],
  [immutableArtifactBytes,98304], [regularFileObservationBytes,98304],
  [directoryEntryCount,256], [aggregateLifecycleEntryCount,1536],
  [inventoryScopeCount,221959],
  [observationCount,257], [completedOperationStepCount,15],
  [operationStepNumericMaximum,34],
  [canonicalRequestBytes,262144], [canonicalInventoryOrReceiptBytes,1048576],
  [consecutiveEintrReadWriteRetries,8], [inventoryRequestsPerTraversal,250000]
]
directoryRoles = [STATE_ROOT,LIFETIMES,LIFETIME_SEGMENT,STAGING,ACTIVE,
  CLOSED,RECOVERED,QUARANTINED,GENERATION,NORMAL_JOURNAL,
  RECOVERY_JOURNAL,RECOVERY_ATTEMPT]
rootDirectoryNames = [lifetimes,staging,active,closed,recovered,quarantined]
nameGrammars = [
  [digestDirectory,^[0-9a-f]{64}$],
  [finalRecord,^[0-9]{16}-[0-9a-f]{64}\\.jsonl$],
  [generationManifest,^generation\\.jsonl$],
  [fixedDirectory,^(lifetimes|staging|active|closed|recovered|quarantined|normal|recovery)$],
  [temporaryFile,^\\.(generation\\.jsonl|[0-9]{16}-[0-9a-f]{64}\\.jsonl)\\.tmp-[0-9a-f]{64}$]
]
plannerKinds = [LOCK_EX_NB,INVENTORY,RELEASE_DIRECTORY,AUTO]
operations = [LOCK_EX_NB,INVENTORY,PERSIST_NOREPLACE,MKDIR_SYNC,
  MOVE_NOREPLACE_SYNC,MOVE_SYNC_REOBSERVE,TEMP_CLEANUP,RELEASE_DIRECTORY]
inventoryKinds = [NONE,DIRECTORY,REGULAR_FILE]
executorResultStatuses = [COMPLETE,REJECTED,SYSCALL_FAILED,LIMIT_EXCEEDED,
  FAULT_INJECTED,VERIFICATION_FAILED]
receiptStatuses = [COMPLETE,REJECTED,SYSCALL_FAILED,LIMIT_EXCEEDED,
  FAULT_INJECTED,VERIFICATION_FAILED,OBSERVATION_ONLY]
effectClasses = [NO_EFFECT,DEFINITE_NO_EFFECT,COMPLETE,
  MUTATION_OBSERVED_NOT_FULLY_SYNCED,EFFECT_UNCERTAIN]
outcomes = [LOCK_HELD,LOCK_CONTENDED,INVENTORY_OBSERVED,
  ALREADY_PRESENT_EXACT,PERSISTED,DIRECTORY_ALREADY_PRESENT_EXACT,
  DIRECTORY_CREATED,DESTINATION_ALREADY_PRESENT_EXACT,MOVED,
  MOVE_SYNC_COMPLETED,TEMP_ALREADY_ABSENT,TEMP_REMOVED,DIRECTORY_RELEASED,
  FAILED_DEFINITE_NO_EFFECT,
  FAILED_MUTATION_NOT_FULLY_SYNCED,FAILED_EFFECT_UNCERTAIN,REJECTED]
retryDispositions = [NO_RETRY,REPLAN_AFTER_FRESH_INVENTORY]
errorPrecedence = [STATEFS_BOUNDS,STATEFS_SHAPE,STATEFS_GRAMMAR,
  STATEFS_PREDECESSOR,STATEFS_BINDING,STATEFS_REQUEST,STATEFS_RESULT,
  STATEFS_TRANSITION]
fdRules = [held-dirfd-relative-only/v1,exact-role-identity/v1,
  same-mount/v1,no-alias/v1,readonly-directory/v1,cloexec-by-role/v1,
  reject-at-fdcwd-opath-root-path/v1]
metadataRules = [expected-owner-uid-gid/v1,private-mode/v1,
  regular-link-count-one/v1,directory-link-count-minimum-two/v1,
  no-follow/v1,no-repeated-inode/v1,raw-name-bytes-01-7f/v1,
  ascii-byte-order/v1,statx-required-mask-0x17ff/v1]
syscallRules = [linux-amd64-direct-allowlist/v1,one-shot-mutation/v1,
  eintr-read-write-only/v1,errno-immediate/v1,close-no-retry/v1,
  zero-before-syscall/v1,validated-observation-prefix-only/v1,
  live-cleanup-close-upgrades-effect/v1]
orderingRules = [intent-before-effect/v1,write-readback-file-sync-rename-parent-sync/v1,
  move-source-sync-destination-sync-reobserve/v1,outcome-last/v1,
  ambiguous-effect-no-retry/v1,fresh-inventory-replan/v1]
privateFilesystemProfile = [
  [platform,linux], [architecture,x86_64], [byteOrder,little-endian],
  [filesystemMagic,[0x0000ef53,0x58465342]], [rootMode,0700],
  [regularMode,0600], [ownerSource,manager-held-root-observation],
  [mountInfoSource,/proc/self/mountinfo], [requiredMountOptions,[rw]],
  [forbiddenMountOptions,[ro]], [singleMount,true], [remote,false],
  [overlay,false], [fuse,false], [symlinkRoot,false],
  [maximumHeldDirectoryDescriptors,5], [childNonceBytes,32],
  [runnerInputFields,[scratchParent,runNonceBytes]],
  [childNamePrefix,.oxigraph-statefs-v1-],
  [childNameGrammar,^\.oxigraph-statefs-v1-[0-9a-f]{64}$],
  [childNameBytes,85],
  [setupRules,[copy-nonce-before-path/v1,open-parent-nofollow/v1,
    mkdirat-once-no-replacement/v1,open-child-nofollow/v1,
    exact-owner-mode-mount-identity/v1,longest-mountinfo-match/v1]],
  [recordRules,[minimal-decimal-identities/v1,raw-ascii-kernel-release/v1,
    sorted-unique-decoded-mount-options/v1,digest-mount-point-bytes/v1,
    report-valid-after-child-crosscheck/v1,no-partial-report/v1,
    report-after-cleanup/v1]],
  [cleanupRules,[close-all-continue-record-first/v1,
    no-delete-after-close-error/v1,
    child-rooted-nofollow-depth-first/v1,remove-child-last/v1,
    stop-path-mutation-on-first-error/v1,
    close-cleanup-fds-after-error/v1,close-parent-on-every-exit/v1,
    no-other-path/v1,
    cleanup-failure-preserves-test-failure/v1]],
  [errors,[PRIVATE_FS_PROFILE_BOUNDS,PRIVATE_FS_PROFILE_SHAPE,
    PRIVATE_FS_PROFILE_PATH,PRIVATE_FS_PROFILE_MOUNT,
    PRIVATE_FS_PROFILE_CLEANUP]],
  [reportLimits,[[kernelReleaseBytes,256],[mountPointBytes,4096],
    [mountOptionCount,256],[mountOptionBytes,255]]]
]
```

`heldDirectoryObservationFields`, `inventoryEntryFields`,
`inventoryObservationFields`, `inventorySetFields`,
`directoryHandlePreimageFields`, `plannerInputFields`, `ownerContextFields`,
`planFields`, `requestFields`, `nativeObservationFields`,
`executorResultFields`, `receiptFields`, and `privateFilesystemReportFields` are
the ordered field blocks printed in this ADR verbatim. `operationSteps` is the ordered numeric list from
`NONE=0` through `DIRECTORY_RELEASED=34`;
`operationStepSequences` is the table
below encoded as ordered `[operation, denseIntegerArray]` pairs, including
separate present and absent regular-file inventory rows. Authority,
physical-fact, and nonclaim values are the exact ordered values below. Square
bracket pairs above mean two-element dense arrays, not implementation-selected
objects; regex text is stored as the exact printed string without delimiters.
The `statefsImportInventory` reference is a specification alias for the
deep-copied exact array printed earlier, not
strings, live references, or executable expressions.
The profile's `rootMode` and `regularMode` tokens are the strings `0700` and
`0600`, not numbers; `/proc/self/mountinfo` is the exact absolute pathname
string. The two `filesystemMagic` values are the exact strings `0x0000ef53` and
`0x58465342`; a report's decimal filesystem-magic identity must equal the
unsigned integer denoted by one of them. All other unquoted alphabetic tokens in these requirement blocks are
the exact printed strings unless explicitly identified as integer or Boolean.

### Frozen C ABI

The native boundary is System V AMD64, Linux, little-endian, 64-bit pointers,
C17. The header rejects every other data model or byte order at compile time and
contains `_Static_assert` checks for every size and offset below. All integer
fields use `<stdint.h>` fixed-width types; all reserved fields and unused input
slots must be zero. Addresses are `uint64_t` values converted through
`uintptr_t` only after length, nullability, overflow, alignment, and output/input
non-overlap checks.

`struct oxigraph_containment_statefs_request_v1` has alignment 8 and size 192:

| Offset | Type       | Field                         |
| -----: | ---------- | ----------------------------- |
|      0 | `uint32_t` | `abi_version`                 |
|      4 | `uint32_t` | `struct_size`                 |
|      8 | `uint32_t` | `operation`                   |
|     12 | `uint32_t` | `inventory_kind`              |
|     16 | `int32_t`  | `dirfd_a`                     |
|     20 | `int32_t`  | `dirfd_b`                     |
|     24 | `uint32_t` | `dirfd_a_role`                |
|     28 | `uint32_t` | `dirfd_b_role`                |
|     32 | `uint32_t` | `name_a_length`               |
|     36 | `uint32_t` | `name_b_length`               |
|     40 | `uint64_t` | `input_length`                |
|     48 | `uint64_t` | `name_a_address`              |
|     56 | `uint64_t` | `name_b_address`              |
|     64 | `uint64_t` | `input_address`               |
|     72 | `uint64_t` | `observations_address`        |
|     80 | `uint32_t` | `observation_capacity`        |
|     84 | `uint32_t` | `output_capacity`             |
|     88 | `uint64_t` | `output_address`              |
|     96 | `uint32_t` | `test_fault_selector`         |
|    100 | `uint32_t` | `expected_owner_uid`          |
|    104 | `uint32_t` | `expected_owner_gid`          |
|    108 | `uint32_t` | `inventory_directory_role`    |
|    112 | `uint64_t` | `expected_mount_id_a`         |
|    120 | `uint64_t` | `expected_mount_id_b`         |
|    128 | `uint64_t` | `expected_device_major_a`     |
|    136 | `uint64_t` | `expected_device_minor_a`     |
|    144 | `uint64_t` | `expected_inode_a`            |
|    152 | `uint64_t` | `expected_filesystem_magic_a` |
|    160 | `uint64_t` | `expected_device_major_b`     |
|    168 | `uint64_t` | `expected_device_minor_b`     |
|    176 | `uint64_t` | `expected_inode_b`            |
|    184 | `uint64_t` | `expected_filesystem_magic_b` |

`struct oxigraph_containment_statefs_observation_v1` has alignment 8 and size
384:

| Offset | Type           | Field              |
| -----: | -------------- | ------------------ |
|      0 | `uint32_t`     | `struct_size`      |
|      4 | `uint32_t`     | `kind`             |
|      8 | `uint32_t`     | `role`             |
|     12 | `uint32_t`     | `name_length`      |
|     16 | `uint64_t`     | `device_major`     |
|     24 | `uint64_t`     | `device_minor`     |
|     32 | `uint64_t`     | `inode`            |
|     40 | `uint64_t`     | `mount_id`         |
|     48 | `uint64_t`     | `byte_length`      |
|     56 | `uint64_t`     | `link_count`       |
|     64 | `uint32_t`     | `mode`             |
|     68 | `uint32_t`     | `owner_uid`        |
|     72 | `uint32_t`     | `owner_gid`        |
|     76 | `uint32_t`     | `statx_mask`       |
|     80 | `uint64_t`     | `filesystem_magic` |
|     88 | `uint64_t`     | `content_offset`   |
|     96 | `uint64_t`     | `content_length`   |
|    104 | `uint8_t[256]` | `name`             |
|    360 | `uint64_t`     | `reserved_0`       |
|    368 | `uint64_t`     | `reserved_1`       |
|    376 | `uint64_t`     | `reserved_2`       |

Unused name bytes, content offsets/lengths, and reserved words are zero.
`statx_mask` is zero for `ABSENT`; every other published observation retains
the kernel-returned value and requires all bits in `0x17ff`. Directory inventory
never returns content. Regular-file inventory returns one observation and
places its exact bytes at output offset zero. The C executor does not hash,
sort, parse JSON, select policy, or infer a predecessor; the JS oracle performs
those operations over copied buffers.

`struct oxigraph_containment_statefs_result_v1` has alignment 8 and size 64:

| Offset | Type       | Field                   |
| -----: | ---------- | ----------------------- |
|      0 | `uint32_t` | `abi_version`           |
|      4 | `uint32_t` | `struct_size`           |
|      8 | `uint32_t` | `operation`             |
|     12 | `uint32_t` | `status`                |
|     16 | `uint32_t` | `effect_class`          |
|     20 | `uint32_t` | `last_completed_step`   |
|     24 | `uint32_t` | `failed_step`           |
|     28 | `int32_t`  | `errno_value`           |
|     32 | `uint32_t` | `observation_count`     |
|     36 | `uint32_t` | `output_length`         |
|     40 | `uint32_t` | `completed_step_count`  |
|     44 | `int32_t`  | `returned_directory_fd` |
|     48 | `uint64_t` | `bytes_consumed`        |
|     56 | `uint64_t` | `reserved_u64`          |

The entrypoint is exactly:

```c
int32_t oxigraph_containment_statefs_execute_v1(
    const struct oxigraph_containment_statefs_request_v1 *request,
    struct oxigraph_containment_statefs_result_v1 *result);
```

The caller contract supplies readable request storage, writable result storage,
and every declared caller buffer for its complete declared extent. The function
returns `0` whenever a result was produced, including an operation rejection or
syscall failure. It returns `-1` only when `request` or `result` is null,
misaligned, or their fixed 192-byte and 64-byte ranges overlap; it then performs
no syscall and writes no memory. Numeric range/nonoverlap checks for all other
declared buffers occur before their first access. No other global symbol is
defined or exported.

The ABI version is `1`. Numeric operation values are `INVALID=0`,
`LOCK_EX_NB=1`, `INVENTORY=2`, `PERSIST_NOREPLACE=3`, `MKDIR_SYNC=4`,
`MOVE_NOREPLACE_SYNC=5`, `TEMP_CLEANUP=6`, and
`MOVE_SYNC_REOBSERVE=7`, and `RELEASE_DIRECTORY=8`. Inventory kind values are
`NONE=0`, `DIRECTORY=1`, and `REGULAR_FILE=2`. Directory-role values are zero
for `NONE` and 1 through 12 in the JavaScript role order above. Observation-kind
values are `ABSENT=0`, `REGULAR=1`, `DIRECTORY=2`, `SYMLINK=3`, `FIFO=4`,
`BLOCK_DEVICE=5`, `CHARACTER_DEVICE=6`, `SOCKET=7`, and `OTHER=8`.

`inventory_directory_role` is `STATE_ROOT` for root inventory, the exact target
child role for nested-directory inventory, and zero for every other request.
`dirfd_a_role` remains the actual held parent role in the child form. C copies
only `inventory_directory_role` into the slot-zero target observation; the JS
oracle verifies that the parent-entry grammar admits that child role.

Result status values are `COMPLETE=0`, `REJECTED=1`, `SYSCALL_FAILED=2`,
`LIMIT_EXCEEDED=3`, `FAULT_INJECTED=4`, and `VERIFICATION_FAILED=5`.
Effect-class values are
`NO_EFFECT=0`, `DEFINITE_NO_EFFECT=1`, `COMPLETE=2`,
`MUTATION_OBSERVED_NOT_FULLY_SYNCED=3`, and `EFFECT_UNCERTAIN=4`.

The exact Linux UAPI constants are `O_RDONLY=0x00000000`,
`O_WRONLY=0x00000001`, `O_CREAT=0x00000040`, `O_EXCL=0x00000080`,
`O_ACCMODE=0x00000003`, `O_NONBLOCK=0x00000800`,
`O_LARGEFILE=0x00008000`, `O_DIRECTORY=0x00010000`,
`O_NOFOLLOW=0x00020000`, `O_CLOEXEC=0x00080000`,
`O_PATH=0x00200000`, `F_GETFL=3`, `F_GETFD=1`, `FD_CLOEXEC=1`,
`LOCK_EX=2`, `LOCK_NB=4`,
`AT_FDCWD=-100`, `AT_SYMLINK_NOFOLLOW=0x00000100`,
`AT_EMPTY_PATH=0x00001000`, `STATX_BASIC_STATS=0x000007ff`,
`STATX_MNT_ID=0x00001000`, `S_IFMT=0170000`, `S_IFREG=0100000`,
`S_IFDIR=0040000`, `S_IFLNK=0120000`, `S_IFIFO=0010000`,
`S_IFBLK=0060000`, `S_IFCHR=0020000`, `S_IFSOCK=0140000`,
`S_ISUID=0004000`, `S_ISGID=0002000`, `S_ISVTX=0001000`, and
`RENAME_NOREPLACE=1`. The C header defines and
statically checks these literals; it does not inherit implementation-selected
values from libc headers. `AT_FDCWD` is listed only to freeze the rejected
value and is never passed.

The request shape per operation is exact. A dash means integer zero, a null
address, and zero length/capacity; no ignored nonzero slot exists:

| Operation                   | FD A / FD B                                    | inventory kind | name A / name B                  | input                  | observations / output                      |
| --------------------------- | ---------------------------------------------- | -------------- | -------------------------------- | ---------------------- | ------------------------------------------ |
| `LOCK_EX_NB`                | `STATE_ROOT` / —                               | `NONE`         | — / —                            | —                      | exactly 1 / 0                              |
| `INVENTORY/DIRECTORY/ROOT`  | `STATE_ROOT` / —                               | `DIRECTORY`    | — / —                            | —                      | exactly 257 / exactly 32,768 scratch bytes |
| `INVENTORY/DIRECTORY/CHILD` | exact held parent / —                          | `DIRECTORY`    | exact child / —                  | —                      | exactly 257 / exactly 32,768 scratch bytes |
| `INVENTORY/REGULAR_FILE`    | containing directory role / —                  | `REGULAR_FILE` | exact final name / —             | —                      | exactly 1 / exactly 98,304 bytes           |
| `PERSIST_NOREPLACE`         | containing directory role / —                  | `NONE`         | exact temporary / exact final    | 1 through 98,304 bytes | exactly 1 / exactly 98,304 bytes           |
| `MKDIR_SYNC`                | containing directory role / —                  | `NONE`         | exact child / —                  | —                      | exactly 1 / 0                              |
| `MOVE_NOREPLACE_SYNC`       | exact source parent / exact destination parent | `NONE`         | exact source / exact destination | —                      | exactly 2 / 0                              |
| `MOVE_SYNC_REOBSERVE`       | exact source parent / exact destination parent | `NONE`         | exact source / exact destination | —                      | exactly 2 / 0                              |
| `TEMP_CLEANUP`              | containing directory role / —                  | `NONE`         | exact temporary / —              | —                      | exactly 1 / 0                              |
| `RELEASE_DIRECTORY`         | exact nonroot held directory / —               | `NONE`         | — / —                            | —                      | 0 / 0                                      |

The capacities in the last column are request-buffer extents, not result
lengths. Complete present regular-file inventory alone returns nonzero
`output_length`, exactly the observed content length. Absent regular-file
inventory and every other operation return `output_length=0`; in particular,
directory inventory and persistence use their output areas only as bounded
executor scratch/readback storage and expose null JS `outputBytes`. Unused bytes
remain outside the result and are never hashed as evidence.

Every nonzero capacity has a nonzero naturally aligned address and every zero
capacity has a zero address. Name addresses follow the same rule. Expected
mount A is nonzero whenever FD A is present; expected mount B is nonzero exactly
when FD B is present. Device major and minor may each be zero and are exact
uint64 values from the corresponding private-branded held directory; inode,
mount ID, and filesystem magic are nonzero. All five identity fields are zero
for an absent FD slot, whose role and FD value independently disambiguate
absence from a present device number containing zero.
Observation/output/input/name ranges may not overlap one
another, the request, or the result. The executor zeroes the complete result and
every observation slot it will publish before its first filesystem syscall;
sets `returned_directory_fd=-1` before that syscall; it
never reports partially initialized caller memory. After each `statx`, it checks
the returned mask before reading governed metadata and advances
`observation_count` only after the complete current slot—or, for directory
entries, the complete step-6 entry group—is publishable. A terminal path exposes
only the operation-specific prefix frozen above and leaves every incomplete
slot zero.

`expected_owner_uid` and `expected_owner_gid` are always the exact bounded
values from the manager-accepted held state-root observation. Every existing
parent/object `statx` result must match both before mutation or content read;
there is no current-process identity syscall or inferred owner. A mismatch is
`REJECTED/NO_EFFECT` before mutation and never a tolerated observation. A newly
created temporary or directory cannot be preobserved: its parent is fully
validated first, then the new object's owner UID/GID, type, mode, link count,
mount, filesystem, and fresh identity are validated immediately at step 33
before write or sync. Failure there is
`VERIFICATION_FAILED/MUTATION_OBSERVED_NOT_FULLY_SYNCED`, preserves the residue,
and is never recast as pre-mutation rejection.
For lock, `FD_A_VALIDATED` publishes the complete current held-directory
observation in slot zero before `flock`; JS requires exact equality to the
planner's copied state-root observation. This is current descriptor consistency,
not origin authentication. Only ADR-0038 may supply the actual inherited FD,
and it must first verify the exact branded manager transition, compare that FD
to the manager-bound observation and expected UID/GID/mount identity, and reject
before C on mismatch. This ADR, its digest inputs, and C alone make no
state-root-origin, service-manager, or descriptor-ownership claim.

Operation-step values are exactly:

```text
0 NONE
1 REQUEST_VALIDATED
2 FD_A_VALIDATED
3 FD_B_VALIDATED
4 LOCK_ACQUIRED
5 INTERNAL_DESCRIPTOR_OPENED
6 DIRECTORY_ENUMERATED
7 ENTRY_REOBSERVED
8 TEMP_CREATED
9 TEMP_WRITTEN
10 TEMP_READ_BACK
11 TEMP_FILE_SYNCED
12 FINAL_INSTALLED
13 CHILD_DIRECTORY_CREATED
14 CHILD_DIRECTORY_SYNCED
15 SOURCE_REOBSERVED
16 GENERATION_MOVED
17 SOURCE_PARENT_SYNCED
18 DESTINATION_PARENT_SYNCED
19 TEMP_UNLINKED
20 PARENT_SYNCED
21 DESTINATION_REOBSERVED
22 SOURCE_ABSENCE_REOBSERVED
23 TEMP_ABSENCE_REOBSERVED
24 INVENTORY_DESCRIPTOR_CLOSED
25 TEMP_READ_DESCRIPTOR_OPENED
26 TEMP_READ_DESCRIPTOR_CLOSED
27 TEMP_WRITE_DESCRIPTOR_CLOSED
28 FINAL_READ_DESCRIPTOR_OPENED
29 FINAL_READ_DESCRIPTOR_CLOSED
30 CHILD_DESCRIPTOR_CLOSED
31 PRE_SYNC_DESTINATION_REOBSERVED
32 DIRECTORY_HANDLE_TRANSFERRED
33 CREATED_METADATA_VALIDATED
34 DIRECTORY_RELEASED
```

The completed steps must be the exact dense prefix for the selected operation;
the result exposes the count and last step, not a caller-selected bitmap. The
operation sequences are exactly:

| Operation                        | Dense step sequence                                    |
| -------------------------------- | ------------------------------------------------------ |
| `LOCK_EX_NB`                     | 1, 2, 4                                                |
| `INVENTORY/DIRECTORY/ROOT`       | 1, 2, 5, 6, 24                                         |
| `INVENTORY/DIRECTORY/CHILD`      | 1, 2, 5, 6, 32                                         |
| `INVENTORY/REGULAR_FILE/PRESENT` | 1, 2, 5, 7, 24                                         |
| `INVENTORY/REGULAR_FILE/ABSENT`  | 1, 2, 7                                                |
| `PERSIST_NOREPLACE`              | 1, 2, 8, 33, 9, 25, 10, 26, 11, 27, 12, 20, 28, 21, 29 |
| `MKDIR_SYNC`                     | 1, 2, 13, 33, 5, 14, 30, 20, 21                        |
| `MOVE_NOREPLACE_SYNC`            | 1, 2, 3, 15, 16, 17, 18, 22, 21                        |
| `MOVE_SYNC_REOBSERVE`            | 1, 2, 3, 15, 31, 17, 18, 22, 21                        |
| `TEMP_CLEANUP`                   | 1, 2, 15, 19, 20, 23                                   |
| `RELEASE_DIRECTORY`              | 1, 2, 34                                               |

Failure before a step reports the preceding completed step, that step as
`failed_step`, and no later observation. Failure after a successful syscall
records that step completed. `errno_value` is copied immediately from the
failing syscall and never replaced by cleanup. Internal close failure is
`EFFECT_UNCERTAIN`; the executor never retries `close` after `EINTR`.

`bytes_consumed` is zero for lock, directory inventory, mkdir, move, cleanup,
and every prevalidation rejection. For persistence it is the exact cumulative
positive bytes written before the reported boundary; a complete result equals
`input_length`. For regular-file inventory it is the exact cumulative positive
bytes read before the reported boundary; a complete present-file result equals
the observed file length and a complete absent observation is zero. It never
counts readback bytes, directory bytes, attempted-but-untransferred bytes, or
caller-buffer initialization. Values inconsistent with the completed step,
input/output length, or observations are `STATEFS_RESULT`.

The native executor-result effect classification is exact. Validation/limit rejection before the first
syscall is `NO_EFFECT`. Lock, inventory, initial create/open, or initial move
no-replace failure before any successful mutation is `DEFINITE_NO_EFFECT`.
Successful lock or
complete inventory is `COMPLETE`. After temporary creation, directory creation,
rename, or unlink, any missing required write/readback/sync/reobservation step is
`MUTATION_OBSERVED_NOT_FULLY_SYNCED` when the current mutation is directly
known and `EFFECT_UNCERTAIN` when the failing syscall's effect itself cannot be
distinguished. Only the full sequence is `COMPLETE`. Native `REJECTED` pairs
with `NO_EFFECT`, except for the exact live-descriptor cleanup-close upgrade to
`EFFECT_UNCERTAIN`. `LIMIT_EXCEEDED` pairs with `NO_EFFECT` before the first syscall and
`DEFINITE_NO_EFFECT` after read-only enumeration or reading; it never pairs with
a mutation class. `COMPLETE` executor status pairs only with `COMPLETE` effect;
`SYSCALL_FAILED`, `FAULT_INJECTED`, and post-mutation
`VERIFICATION_FAILED` pair with the one exact effect implied by their step
boundary. `VERIFICATION_FAILED` covers an exact readback, EOF, metadata, or
reobservation mismatch after mutation and always retains honest residue; the
same mismatch before mutation is `REJECTED/NO_EFFECT`. Every other native
executor status/effect pair is `STATEFS_RESULT`, except that a pre-mutation
`REJECTED/NO_EFFECT` whose actually acquired internal descriptor fails its
one-shot cleanup close becomes the narrow
`REJECTED/EFFECT_UNCERTAIN` pair. A verified receipt copies that native pair
except for exactly two receipt-only branches:
`OBSERVATION_ONLY/DEFINITE_NO_EFFECT` for a null executor result selected by the
planner, and `REJECTED/DEFINITE_NO_EFFECT` for the ABI-valid complete but
semantically unsafe inventory branch frozen above. No other receipt
status/effect pair is legal.

The frozen Linux x86-64 errno values used symbolically are `EPERM=1`,
`ENOENT=2`, `EINTR=4`, `EIO=5`, `EBADF=9`, `EAGAIN=11`,
`EWOULDBLOCK=11`, `EACCES=13`, `EFAULT=14`, `EEXIST=17`, `ENOTDIR=20`,
`EISDIR=21`, `EINVAL=22`, `EFBIG=27`, `ENOSPC=28`, `EROFS=30`,
`EMLINK=31`, `ENAMETOOLONG=36`, `ENOSYS=38`, `ENOTEMPTY=39`,
`ELOOP=40`, `EOVERFLOW=75`, `EOPNOTSUPP=95`, and `ESTALE=116`.
Every other numeric errno from 1 through 4095 is the exhaustive `OTHER` class;
it is never guessed into a symbolic branch.

Errno mapping is exhaustive. `EAGAIN/EWOULDBLOCK` from `flock` is
`SYSCALL_FAILED/DEFINITE_NO_EFFECT/LOCK_CONTENDED`. `ENOENT` from the initial
regular-file observation is consumed as
`COMPLETE/COMPLETE/INVENTORY_OBSERVED` with one `ABSENT` observation and reported
errno zero. `EINTR` from `read` or `write` before a positive transfer retries
that call at most eight consecutive times; positive progress resets the count;
the ninth is reported. No other errno or syscall retries. For every reported
real errno, status is `SYSCALL_FAILED`; the effect class below selects exactly
`FAILED_DEFINITE_NO_EFFECT`, `FAILED_MUTATION_NOT_FULLY_SYNCED`, or
`FAILED_EFFECT_UNCERTAIN`. `D`, `M`, and `U` abbreviate those three effect/outcome
pairs:

| Operation                      | Failing step(s), after special cases above            | Class |
| ------------------------------ | ----------------------------------------------------- | ----- |
| lock                           | 2, 4                                                  | `D`   |
| either inventory               | 2, 5, 6, 7, 32 and every read-only validation syscall | `D`   |
| root or present-file inventory | 24 (`close` returns failure)                          | `U`   |
| persist                        | 8                                                     | `D`   |
| persist                        | 33, 9, 25, 10, 11, 12                                 | `M`   |
| persist                        | 26, 27, 20, 28, 21, 29                                | `U`   |
| mkdir                          | 13                                                    | `D`   |
| mkdir                          | 33, 5, 14                                             | `M`   |
| mkdir                          | 30, 20, 21                                            | `U`   |
| initial move                   | 2, 3, 15, 16                                          | `D`   |
| initial move                   | 17, 18                                                | `M`   |
| initial move                   | 22, 21                                                | `U`   |
| move sync/reobserve            | every syscall step                                    | `U`   |
| cleanup                        | 2, 15, 19                                             | `D`   |
| cleanup                        | 20, 23                                                | `U`   |
| release directory              | 2                                                     | `D`   |
| release directory              | 34                                                    | `U`   |

Step 1 and a successfully observed identity/metadata mismatch at steps 2 or 3
produce `REJECTED/NO_EFFECT/REJECTED` with errno zero. An actual
`fcntl`/`statx`/`fstatfs` failure while attempting steps 2 or 3 is
`SYSCALL_FAILED/DEFINITE_NO_EFFECT` with its numeric errno (or remains `U` for
the already-unresolved sync-only operation); those syscalls are included in
every operation row above. An actual failing `close` at inventory step 24 is
`SYSCALL_FAILED/EFFECT_UNCERTAIN/FAILED_EFFECT_UNCERTAIN`: the descriptor might
be open, and neither statefs nor ADR-0038 retries that close. A before-step-24
fault starts as `D`; its mandatory failure cleanup upgrades it to `U` if that
single cleanup close fails. An after-step-24 fault remains `D` because the
enumerated close completed successfully before injection. Output-capacity exhaustion is
`LIMIT_EXCEEDED` with errno zero under the pairing rule above. An `EEXIST` or
`ENOENT` at a mutating step follows the same row as every other errno and never
selects an already-observed outcome. This partitions every operation, step, and
numeric errno without an implementation default.

Every pre-mutation `statx` required-mask failure, unrepresentable directory
record, or successful observed-metadata mismatch governed by the 2026-09-04
correction follows `REJECTED/NO_EFFECT/REJECTED`, with errno zero, at its owning
failed step. It retains the exact preceding dense step prefix and only the
operation-specific publishable observations frozen above. If an internal
descriptor was actually acquired and its mandatory cleanup close fails, status
remains `REJECTED`, errno remains zero, effect and outcome become
`EFFECT_UNCERTAIN` and `FAILED_EFFECT_UNCERTAIN`, and every other field remains
that same prefix. The verifier permits this pair only at an exact boundary
where such a descriptor can be live; it rejects the pair at validation or
failed-open boundaries where liveness is impossible.

For fault selectors, status is `FAULT_INJECTED`, errno is exactly `EIO=5`, and
outcome again follows `D/M/U`. The exact before/after class arrays below align
positionally with each operation's dense step sequence. They are also the
complete final-step rule: the last after-selector is `U` for a mutating
operation and `D` for read-only inventory; it is never converted to success.

```text
LOCK_EX_NB before=[D,D,D] after=[D,D,U]
INVENTORY/DIRECTORY/ROOT before=[D,D,D,D,D] after=[D,D,D,D,D]
INVENTORY/DIRECTORY/CHILD before=[D,D,D,D,D] after=[D,D,D,D,D]
INVENTORY/REGULAR_FILE/PRESENT before=[D,D,D,D,D] after=[D,D,D,D,D]
INVENTORY/REGULAR_FILE/ABSENT before=[D,D,D] after=[D,D,D]
PERSIST_NOREPLACE
  before=[D,D,D,M,M,M,M,M,M,M,M,M,M,M,M]
  after =[D,D,M,M,M,M,M,M,M,M,M,M,M,M,U]
MKDIR_SYNC before=[D,D,D,M,M,M,M,M,M] after=[D,D,M,M,M,M,M,M,U]
MOVE_NOREPLACE_SYNC before=[D,D,D,D,D,M,M,M,M] after=[D,D,D,D,M,M,M,M,U]
MOVE_SYNC_REOBSERVE before=[U,U,U,U,U,U,U,U,U] after=[U,U,U,U,U,U,U,U,U]
TEMP_CLEANUP before=[D,D,D,D,M,M] after=[D,D,D,M,M,U]
RELEASE_DIRECTORY before=[D,D,D] after=[D,D,U]
```

For a before-selector on numeric step `n`, the result has
`FAULT_INJECTED`, errno `EIO`, the completed dense prefix strictly before `n`,
`completed_step_count` equal to that prefix length,
`last_completed_step` equal to its last element or `NONE` when empty, and
`failed_step=n`. For an after-selector on `n`, the completed prefix includes
`n`, its length is `completed_step_count`, `last_completed_step=n`, and
`failed_step=NONE`; status remains `FAULT_INJECTED`, errno remains `EIO`, and
the positional after-array fixes the effect and outcome. This applies unchanged
to the final step: an after-final injection is a failure with the complete
prefix and `failed_step=NONE`, never a `COMPLETE` result. Bytes, observations,
transferred directory FD, and descriptor-retirement state expose only what that
exact prefix produced.

Production requires `test_fault_selector=0`. A fault build compiled with
`OXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS=1` accepts selectors `2*n-1` (before)
and `2*n` (after), where `n` is that step's numeric enum value rather than its
ordinal position in the operation sequence, and injects `EIO`; any other selector rejects. Production performs only the generic
reserved-zero validation of the field: its preprocessed source and object
contain no selector interpretation, fault table, conditional injection branch,
`EIO` injection, environment read, or setter. The fault build is never linkable
into a production artifact.

### Syscall and operation contract

The translation unit uses private direct Linux x86-64 syscall wrappers and no
libc, allocator, thread, locale, environment, callback, pathname-root, process,
cgroup, network, clock, random, logging, or dynamic-loading API. The complete
syscall allowlist is `fcntl`, `statx`, `fstatfs`, `flock`, `openat`,
`getdents64`, `read`, `write`, `fsync`, `renameat2`, `mkdirat`,
`unlinkat`, and `close`. Any emitted call to another syscall, PLT entry, or
undefined symbol rejects attestation.

The exact Linux x86-64 syscall-number map, sorted numerically, is `read=0`,
`write=1`, `close=3`, `fcntl=72`, `flock=73`, `fsync=74`,
`fstatfs=138`, `getdents64=217`, `openat=257`, `mkdirat=258`, `unlinkat=263`,
`renameat2=316`, and `statx=332`. Compilation against a header or target with a
different value fails before object acceptance.

Common descriptor validation uses `fcntl(F_GETFL)`, `fcntl(F_GETFD)`,
`statx(fd, "", AT_EMPTY_PATH|AT_SYMLINK_NOFOLLOW, ...)`, and `fstatfs`.
`STATE_ROOT` must match the ADR-0036 observation, including inherited
close-on-exec false; statefs-opened children use
`O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW`. Required mount IDs are nonzero and
must match. Distinct roles may not alias one descriptor, open-file description,
or directory identity. The executor never accepts `AT_FDCWD`, a negative FD, an
`O_PATH` FD, writable directory access, or a caller pathname for the root.

The descriptor handoff is exact. ADR-0038 starts with one private map entry from
the root handle digest to the already-held `STATE_ROOT` FD. Before every C call,
it accepts only an exact manager transition, looks up each request handle, and
requires the mapped FD's current device major/minor, inode, mount ID,
filesystem magic, owner UID/GID, type, access mode, and close-on-exec state to
equal the request and held observation. A nested-directory inventory returns
one provisional CLOEXEC FD in `returned_directory_fd`. The adapter calls the
statefs result verifier before publishing it: verifier failure causes one
best-effort close and no map insertion; a complete
`INVENTORY_OBSERVED` receipt inserts exactly the receipt's new directory handle
and the returned FD. For the exact verified after-step-32 fault receipt, the
adapter instead performs one best-effort close of the provisional returned FD
and performs no map insertion; the close result is diagnostic and cannot alter
that receipt. No other result may return an FD.
`RELEASE_DIRECTORY` passes that exact mapped nonroot FD to C once, removes the
map entry after complete close or any actually attempted Linux close, and can
never reuse that integer. A fault or failure before step 34 performs no C close
and has `NO_RETRY`. After statefs verifies that exact no-retry release receipt,
the ADR-0038 adapter performs exactly one best-effort teardown `close` on the
still-mapped descriptor, removes the map entry regardless of its return, and
never exposes or retries that cleanup result. This teardown grants no close or
durability fact and cannot change the receipt or terminal manager outcome. A
receipt with `REPLAN_AFTER_FRESH_INVENTORY` similarly requires ADR-0038 to
best-effort close and remove every nonroot mapping once in reverse manager-stack
order after the manager accepts the receipt and before it submits the next root
inventory plan. Cleanup failure is diagnostic, does not alter the verified
receipt or transition, and does not permit reuse of any retired FD integer.
A
manager/adapter crash loses all nonroot entries and the
replacement begins from a newly authenticated root plus fresh inventory; no
digest resurrects a descriptor.

Traversal is deterministic depth-first, not breadth-first. Children follow the
same printed ASCII order, but a child directory is opened, inventoried, fully
visited, and explicitly released before its next sibling. The only two maximum
depths are `STATE_ROOT/LIFETIMES/LIFETIME_SEGMENT` and
`STATE_ROOT/{lifecycle}/GENERATION/RECOVERY_JOURNAL/RECOVERY_ATTEMPT`; including
the root, at most five held directory FDs exist. A C call adds at most three
internal file descriptors, so the exact combined descriptor ceiling is eight.
After full traversal only the root remains. Later physical work is one
deterministic depth-first mutation pass: each unique root-to-directory chain is
opened once through nested-directory inventory, all owner-replay-admitted work
for that directory is processed in canonical name/record order, and the chain
is released in reverse order. Each exact receipt updates the manager's private
current-inventory model before the next request; an unchanged entry is never
silently assumed across a mutation, and a changed scope is re-inventoried when
the receipt does not supply its complete post-state. A lifecycle move may hold
the two already-verified parent chains simultaneously within the same
five-directory bound. No manager or ADR-0038 implementation may invent a
pathname reopen, reopen a path once per file, retain a sibling frontier, or
require an elevated `RLIMIT_NOFILE`.

The exact operation mechanics are:

1. `LOCK_EX_NB` validates `STATE_ROOT`, then calls
   `flock(dirfd_a, LOCK_EX|LOCK_NB)` once. `EWOULDBLOCK`/`EAGAIN` is definite no
   effect and maps to `LOCK_CONTENDED`; every other error remains its errno.
   There is no lock file or fallback pathname.
2. `INVENTORY/DIRECTORY/ROOT` opens literal `.` relative to `STATE_ROOT` with
   `O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW`; the child form instead opens
   exact `name_a` relative to the held parent and verifies the identity copied
   from its parent's inventory. Both enumerate with a fixed 32,768-byte
   `getdents64` buffer until EOF or 256 entries and observe each entry with
   no-follow `statx`. Slot zero is the complete held target-directory
   observation and up to 256 entries occupy following slots; `.` and `..` are
   discarded and no other entry is hidden. Root closes its enumeration clone;
   child inventory transfers its still-open target descriptor exactly as above.
   Exceeding the bound is `LIMIT_EXCEEDED`, never a truncated success.
3. `INVENTORY/REGULAR_FILE` opens exactly `name_a` with
   `O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK`, verifies owner-mode `0600`, link
   count one, regular type and mount, then reads from offset zero through EOF
   into the bounded output buffer. A short buffer is `LIMIT_EXCEEDED`, not a
   prefix observation. `ENOENT` from the initial no-follow observation is a
   successful single `ABSENT` observation with zero content; it is not an errno
   converted by a later mutating operation. A present non-regular kind is
   observed without being opened for content and produces `REJECTED`.
4. `PERSIST_NOREPLACE` opens the exact temporary name `name_a` with
   `O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC|O_NOFOLLOW`, mode `0600`; verifies it;
   performs bounded full writes; opens a second internal descriptor for that
   temporary with `O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK`; reads from offset
   zero and byte-compares the complete input; closes the reader once; `fsync`s
   the writer; closes the writer once; installs the temporary as final `name_b`
   with `renameat2(..., RENAME_NOREPLACE)`; `fsync`s the containing directory;
   opens one final read-only descriptor with those same flags; reobserves and
   byte-compares the final; then closes it once. Internal descriptors are
   opened in writer, temporary-reader, final-reader order and closed in
   temporary-reader, writer, final-reader order. Cleanup failure never unlinks,
   retries a close, retries the rename, or hides residue. A partial write or any
   failure after creation leaves honest temporary residue unless the no-replace
   rename already succeeded, in which case the final remains. `EEXIST` never
   becomes idempotent success inside this operation.
5. `MKDIR_SYNC` calls `mkdirat(dirfd_a,name_a,0700)`, opens and validates the
   child without following, `fsync`s the child, `fsync`s its parent, and
   reobserves its exact identity. `EEXIST` is definite no effect and requires a
   separate inventory/replan; it is not success in this operation.
6. `MOVE_NOREPLACE_SYNC` first reobserves one exact source and absent
   destination, calls `renameat2(dirfd_a,name_a,dirfd_b,name_b,
RENAME_NOREPLACE)` once, `fsync`s the source parent then destination parent,
   reobserves source absence, and reobserves the same directory identity at the
   destination. Source and destination parents must be distinct held roles on
   one mount. `EEXIST` is definite no move and never overwrites.
7. `MOVE_SYNC_REOBSERVE` is accepted with the exact durable move decision and
   complete fresh inventory frozen above. The exact unresolved receipt is an
   additional binding only when that same-process value survived and is never
   required after a process loss. It first observes
   source absence and the exact destination generation identity without
   mutation, then `fsync`s source parent followed by destination parent,
   reobserves source absence, and reobserves the identical destination. It never
   calls rename and cannot be selected for a failed-before-rename, collision,
   ambiguous-rename, changed destination, or source-present prefix.
8. `TEMP_CLEANUP` first reobserves a matching owner-mode `0600`, link-count-one
   regular temporary file, calls `unlinkat(dirfd_a,name_a,0)`, `fsync`s the
   parent, and reobserves absence. `ENOENT` is definite no effect and requires a
   fresh inventory plus the exact complete tail-matched final-artifact owner
   replay above to derive `TEMP_ALREADY_ABSENT`; it is not rewritten as a
   successful unlink.
9. `RELEASE_DIRECTORY` accepts only a nonroot, privately mapped directory
   handle, revalidates it, calls `close` once, and returns no observation or FD.
   A close error is effect-uncertain and terminal for this protocol instance;
   the descriptor integer is retired even on Linux `EINTR` and is never retried.

On any exit with an internal descriptor still open, the executor makes one
best-effort `close` call per remaining descriptor in reverse-open order. These
failure cleanup calls have no selector, never retry, never add a completed
operation step, never replace the first reported errno, and never unlink or
rename. A cleanup-close error upgrades `D` or `M` to `U`; it cannot downgrade
`U` or produce success. It also upgrades a base `NO_EFFECT` to `U` if and only
if the descriptor was actually acquired. Liveness begins at the successful
`openat` return rather than completion of step 5; a failed open or any other
impossible-live boundary cannot select `U`. On a successful path, every
internal close is an enumerated step and no hidden cleanup close remains.

`read`/`write` advance only after a positive count. A zero `write` before all
`input_length` bytes are transferred is
`VERIFICATION_FAILED/MUTATION_OBSERVED_NOT_FULLY_SYNCED` with errno zero,
`failed_step=TEMP_WRITTEN`, the preceding dense step as `last_completed_step`,
the exact partial `bytes_consumed`, and outcome
`FAILED_MUTATION_NOT_FULLY_SYNCED`. A zero `read` before the exact length fixed
by the statx observation or request, or a positive byte after that length before
the required EOF, is `VERIFICATION_FAILED` with errno zero and the readback or
entry-reobservation step as `failed_step`. For regular-file inventory that step
is `ENTRY_REOBSERVED`, its effect is `DEFINITE_NO_EFFECT`, outcome is
`FAILED_DEFINITE_NO_EFFECT`, and last step is `INTERNAL_DESCRIPTOR_OPENED`; for
temporary readback the failed step is `TEMP_READ_BACK`, its effect/outcome is
`MUTATION_OBSERVED_NOT_FULLY_SYNCED`/`FAILED_MUTATION_NOT_FULLY_SYNCED` and last
step is `TEMP_READ_DESCRIPTOR_OPENED`; for post-install final readback its
failed step is `DESTINATION_REOBSERVED`, effect/outcome is
`EFFECT_UNCERTAIN`/`FAILED_EFFECT_UNCERTAIN`, and last step is
`FINAL_READ_DESCRIPTOR_OPENED`. An exact zero-length file still requires one
zero read and therefore cannot bypass EOF observation. These zero-return and
length-mismatch paths are verifier failures, not syscall failures, and never
invent an errno. A negative `EINTR` before transferred bytes repeats only that
nonmutating call under the exact eight-consecutive limit above. Partial positive transfer is recorded and the loop continues
within the 98,304-byte bound. `fsync`, `renameat2`, `mkdirat`, `unlinkat`,
`flock`, and `close` are each attempted once and are never retried after any
error. Integer/pointer overflow, overlapping buffers, output-capacity mismatch,
bad reserved data, bad enum, or inconsistent null/length pair rejects before
the first syscall.

The JS result statuses are the ABI names. Exact receipt outcomes, in order, are:

```text
LOCK_HELD
LOCK_CONTENDED
INVENTORY_OBSERVED
ALREADY_PRESENT_EXACT
PERSISTED
DIRECTORY_ALREADY_PRESENT_EXACT
DIRECTORY_CREATED
DESTINATION_ALREADY_PRESENT_EXACT
MOVED
MOVE_SYNC_COMPLETED
TEMP_ALREADY_ABSENT
TEMP_REMOVED
DIRECTORY_RELEASED
FAILED_DEFINITE_NO_EFFECT
FAILED_MUTATION_NOT_FULLY_SYNCED
FAILED_EFFECT_UNCERTAIN
REJECTED
```

The four `*_ALREADY_*` outcomes are selected only from a fresh successful
inventory plus the complete applicable predecessor proof; they never arise by
converting `EEXIST` or `ENOENT` from a mutating request. `PERSISTED`,
`DIRECTORY_CREATED`, `MOVED`, `MOVE_SYNC_COMPLETED`, `TEMP_REMOVED`, and
`DIRECTORY_RELEASED` require the complete exact step
sequence including required sync and reobservation. `retryDisposition` is
exactly `NO_RETRY` or `REPLAN_AFTER_FRESH_INVENTORY`. Selection is exhaustive:
`REPLAN_AFTER_FRESH_INVENTORY` occurs if and only if the operation is neither
`LOCK_EX_NB` nor `RELEASE_DIRECTORY`, status is `SYSCALL_FAILED`, `FAULT_INJECTED`, or
`VERIFICATION_FAILED`, effect class is `DEFINITE_NO_EFFECT`, and outcome is
`FAILED_DEFINITE_NO_EFFECT`. Every other receipt has `NO_RETRY`, including
every `COMPLETE`, `OBSERVATION_ONLY`, `REJECTED`, or `LIMIT_EXCEEDED` status,
lock result, mutation-residue result, and effect-uncertain result. A
`LIMIT_EXCEEDED` or unsafe-inventory result has outcome `REJECTED`; a real
non-lock syscall/fault/verification error with definite no effect has outcome
`FAILED_DEFINITE_NO_EFFECT`. The replan disposition authorizes only a new
planner request after complete fresh root inventory, never replay of the old
request. Mutation-not-fully-synced and effect-uncertain receipts are terminally
`NO_RETRY` for that intent and feed ADR-0035's unresolved-effect path. Every
effect-uncertain receipt has outcome `FAILED_EFFECT_UNCERTAIN`, empty
`inventories`, and a null successor token/digest, including the narrow native
`REJECTED/EFFECT_UNCERTAIN` cleanup case; no such receipt grants a successor or
reusable capability.

### Intent-before-effect and outcome-last ordering

Every mutating request requires a complete branded durable predecessor. The
ordering is exact:

| Physical request                                                | Required durable predecessor                                                                                                                                  | Permitted durable successor                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| persist immutable manifest, bundle, lifetime or recovery record | the owning reducer admits the exact next record and, where applicable, its intent/anchor predecessor is already durable                                       | the final record itself is the outcome; no governed external effect begins until its file and parent are synced |
| create generation, lifetime-segment or attempt directory        | the matching generation/lifetime/attempt allocation or anchor record is durable                                                                               | the exact directory-observed record, when its owning schema defines one                                         |
| move staging to active                                          | generation manifest and activation decision are durable                                                                                                       | bundle 1 may be persisted only after the dual-parent synced move is reobserved                                  |
| move active to closed                                           | state-18 `CLOSED_DURABLE` and exact close plan are durable                                                                                                    | branded normal-close receipt only after dual-parent sync and reobservation                                      |
| move to recovered or quarantined                                | `RECOVERED_TOMBSTONE_DURABLE`, `QUARANTINE_INTENT_DURABLE`, or matching durable adoption decision                                                             | matching location-observed recovery record only after dual-parent sync and reobservation                        |
| remove a temporary file                                         | fresh inventory, deterministic temporary identity, and complete tail-matched replay bind it to an exact already-durable final artifact with no current writer | cleanup receipt only after parent sync and absence reobservation                                                |

No outcome, completion, location, idempotence, or durable-success record may be
constructed before the rightmost condition. A crash before durable intent
authorizes no mutation. A crash after intent but before a complete receipt
requires fresh inventory. If current observation cannot prove either exact
completion or definite no effect, the effect remains uncertain permanently;
neither a catch block nor a replacement manager may retry or invent the missing
outcome.

### Exact manager-protocol-v1 API

`containment-guardian-manager-protocol-v1.mjs` has exactly seven named exports:

```text
CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_PROTOCOL_V1_REQUIREMENTS
CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_PROTOCOL_V1_REQUIREMENTS_SHA256
createCandidateContainmentGuardianManagerActorEpochV1(epochBytes)
createCandidateContainmentGuardianManagerProtocolInputV1(currentState, input)
initializeCandidateContainmentGuardianManagerProtocolV1(epochProjection)
reduceCandidateContainmentGuardianManagerProtocolV1(currentState, brandedInput)
assertCandidateContainmentGuardianManagerProtocolTransitionV1(transition)
```

It has no default/namespace/side-effect export. The requirements value is a
recursive null-prototype frozen record with exactly these top-level fields:

```text
schema
version
predecessors
importInventory
schemas
limits
inputKinds
epochFields
stateFields
inputArgumentFields
inputFields
transitionFields
handoffPlanFields
recoveryRequestArtifactFields
transitionRuleFields
crashPrefixRuleFields
statuses
writerKinds
actorKinds
guardianActions
statefsOutcomes
transitionTable
crashPrefixTable
errorPrecedence
orderingRules
authority
physicalFacts
nonclaims
```

Its schema is
`oxigraph.candidate-containment-guardian-manager-protocol-requirements/v1` and
version is integer `1`. Its requirements digest is computed exactly as for
statefs. The value pins statefs-v1's requirements digest in addition to the
five predecessor identities above.

The exact other schemas are:

| Value                     | Schema                                                                         |
| ------------------------- | ------------------------------------------------------------------------------ |
| epoch projection          | `oxigraph.candidate-containment-guardian-manager-actor-epoch/v1`               |
| protocol input            | `oxigraph.candidate-containment-guardian-manager-protocol-input/v1`            |
| protocol state            | `oxigraph.candidate-containment-guardian-manager-protocol-state/v1`            |
| transition                | `oxigraph.candidate-containment-guardian-manager-protocol-transition/v1`       |
| guardian handoff plan     | `oxigraph.candidate-containment-guardian-manager-handoff-plan/v1`              |
| recovery-request artifact | `oxigraph.candidate-containment-guardian-manager-recovery-request-artifact/v1` |

`createCandidateContainmentGuardianManagerActorEpochV1` accepts one intrinsic,
unshared, non-resizable 32-byte view, copies it before hashing, rejects an
all-zero value, and returns a private-branded value with exact public fields
`schema`, `byteLength`, `managerActorEpochSha256`, `consumed: false`, `authority`,
`physicalFacts`, and `nonclaims`. It exposes no raw epoch bytes. Initialization consumes that
exact object once, changes its private consumed bit, and rejects a second use;
the public frozen projection remains descriptive. No other public function
accepts raw epoch bytes.

This projection represents only ADR-0035's stable
`managerActorEpochSha256`, which is distinct from every segment's
`lifetimeEpochSha256` and every `recoveryActorEpochSha256`. Reconstructing a new
projection after an inner-manager crash requires the external owner to supply
the same retained raw manager-actor bytes; the module proves only byte length,
nonzero content, equality, and one-use of that projection object. It does not
prove freshness, randomness, service-manager identity, or continuity.

`epochFields` is exactly `[schema,byteLength,managerActorEpochSha256,consumed,
authority,physicalFacts,nonclaims]` in that order. The private raw-byte copy,
live consumed marker, and brand are not fields in the projection and cannot be
reconstructed from its permanently false descriptive `consumed` field.

The manager protocol state has exactly these ordered fields:

```text
schema
requirementsSha256
sequence
nextStatefsRequestSequence
inventoryRequestCount
inventorySetSha256
inventoryComplete
activeDirectoryHandleCount
activeDirectoryHandlesSha256
previousStateSha256
stateSha256
managerActorEpochSha256
status
writerKind
actorKind
targetSha256
requiredDurableRecordType
permittedStatefsOperation
permittedGuardianAction
requiredOutcomeRecordType
statefsPlanSha256
statefsRequestSha256
guardianStartupSha256
recoveryRequestFrameRawSha256
lastGuardianWireSequence
lastGuardianWireFrameRawSha256
unresolvedEffect
retryPermitted
terminal
authority
physicalFacts
nonclaims
```

`sequence` begins at zero and is at most 2,999,999.
`nextStatefsRequestSequence` begins at zero, increments only when an exact
statefs request is accepted, becomes null after accepting sequence 999,999, and
never wraps. `inventoryRequestCount` begins at zero for each fresh traversal,
is at most 250,000 within that traversal, and increments only when the matching
inventory receipt is accepted. It does not increment when an inventory request
or plan is accepted. `inventorySetSha256` is null
until the accepted `LOCK_HELD` receipt supplies the exact statefs revision-zero
token, then equals the manager's privately retained exact token digest in every
nonterminal state; a terminal/no-successor row clears both the private token and
public digest to null;
`inventoryComplete` is false
until the exact traversal below closes. `activeDirectoryHandleCount` is from
zero through five and `activeDirectoryHandlesSha256` is null at zero and
otherwise hashes the root-to-leaf ordered active handle array. The initial state has all-zero
`previousStateSha256`, status `LOCK_REQUIRED`, writer kind `SERVICE_MANAGER`,
and all target/action/record/request/guardian-chain fields null, active handle
count zero, null active-handle digest, and no inventory token;
`inventoryComplete`,
`unresolvedEffect`, `retryPermitted`, and `terminal` are false.
`stateSha256` is the repository-canonical SHA-256 of the complete state with only
that field omitted. Every later state binds the exact prior state digest. A
state is private-branded to its module instance and manager-actor epoch; a
successful reduction consumes the input and predecessor state once, so forked
states do not share one-write authority and only one exact predecessor digest
may advance. Validation failure consumes neither. Sequence exhaustion produces
`MANAGER_BOUNDS` before a new input or state exists; a null next-request
sequence rejects every later statefs request with that same code.

Inventory traversal is manager-owned depth-first and exact. It inventories
`STATE_ROOT`; the six fixed root directories in the printed root-name order;
all lifetime segments by ASCII name; the five lifecycle directories in
`STAGING`, `ACTIVE`, `CLOSED`, `RECOVERED`, `QUARANTINED` order; their generation
directories by ASCII name; each generation's `generation.jsonl`, `normal`, and
`recovery` in that order; every normal final file by ASCII name; every recovery
attempt directory by ASCII name; and every recovery final file by ASCII name.
Directories use `INVENTORY/DIRECTORY`; each immutable file uses a separate
`INVENTORY/REGULAR_FILE`. A child is pushed on the private DFS stack only after
its parent receipt is accepted. After its entries are processed, an exact
`RELEASE_DIRECTORY` request/receipt pops it before the next sibling. Until the
stack and pending-entry list are empty, a complete safe inventory or release
receipt returns to `INVENTORY_REQUIRED`, not `REPLAY_REQUIRED`; the empty stack
with only the root handle retained sets `inventoryComplete: true` and only then
enters `REPLAY_REQUIRED`. Any
duplicate identity/name, unexpected child, bound excess, unsafe metadata, or
250,001st request enters `INVENTORY_BLOCKED` (the last case is
`MANAGER_BOUNDS`). This covers the maximum frozen directory and record counts
without relying on one C call or one 256-entry observation.

The whole-manager transition ceiling is independently sufficient. At the
689,440-request structural maximum, accepting one request and one receipt costs
1,378,880 reductions. Allowing two context-only `STATEFS_PLAN` reductions per
request costs another 1,378,880. At most 1,280 normal guardians plus 5,120
recovery-attempt guardians can each contribute ADR-0036's maximum four status
frames, costing 25,600; each recovery guardian can additionally contribute one
`RECOVERY_REQUEST_OBSERVED` reduction, costing 5,120; and one final terminal
reduction is reserved. The total is 2,788,481, below 2,999,999. Initialization is sequence zero and is not a
reduction. A candidate transition that would exceed either the request or total
sequence maximum throws `MANAGER_BOUNDS` before input or state consumption; it
cannot wrap, truncate, silently terminalize, or enter an otherwise unreachable
status.

Protocol input kinds, in order, are exactly:

```text
STATEFS_PLAN
STATEFS_RECEIPT
RECOVERY_REQUEST_OBSERVED
GUARDIAN_STATUS_FRAME
```

`createCandidateContainmentGuardianManagerProtocolInputV1` accepts an exact
record with ordered fields `kind`, `statefsPlan`, `statefsReceipt`,
`guardianStartupProjection`, `guardianControlState`,
`guardianRecoveryRequestFrameBytes`, `guardianRequestEofObserved`, and
`guardianStatusFrameBytes`; every irrelevant
field is null. `STATEFS_RECEIPT` invokes the exact statefs receipt assertion.
For `STATEFS_PLAN`, the manager validates its current-state/epoch/digest/shape
preconditions first, then calls the consuming statefs plan assertion as its
last fallible step. The returned exact owner context and the plan's exact
request/token are retained privately. The assertion must return the exact
object identical to `plan.ownerContext`; the manager checks that object's
public schema/digest and every plan/context equality, then treats the successful
same-origin statefs handoff as the sole capability proof for its contained
owner values. It does not import or invoke journal, lifetime, or recovery owner
assertions and cannot independently authenticate, reconstruct, replace, or
reselect those nested values. Manager writer/handoff transitions derive only
from the already-selected public plan fields and exact returned context; the
manager never reaches statefs lexical metadata or duplicates its filesystem or
owner oracle. The manager's private association also
retains the exact latest inventory-set token and exact accepted request while
awaiting its receipt; none is a public state field.
`RECOVERY_REQUEST_OBSERVED` is accepted only in the exact recovery handoff row
below. It requires a caller-supplied exact ADR-0036 recovery startup projection
and its exact initial control state whose mode, epoch, requirements, and startup
digest match the retained handoff plan, a copied exact recovery-request JSONL frame, and
primitive `guardianRequestEofObserved: true`; the manager calls the imported
ADR-0036 recovery-request input constructor and retains its returned branded
input. This Boolean is the runtime owner's bounded observation, not a physical
EOF fact proved by this pure module.
`GUARDIAN_STATUS_FRAME` invokes
`verifyCandidateContainmentGuardianStatusFrameV1` with the exact startup
projection and copied frame bytes. It then parses those already-verified
canonical bytes with exact-value helpers solely to retain their `sequence` and
`previousFrameSha256`; no unverified parse can reach a transition. No actor-resolution or manager-replacement
lookalike is an input: those facts become usable only after the owning ADR-0035
record is in the complete internally produced lifetime replay. The function validates the
complete owner-module value before returning an input privately bound to
`currentState`. Its public projection has exactly:

```text
schema
kind
boundStateSha256
statefsRequestSha256
statefsReceiptSha256
statefsPlanSha256
ownerContextSha256
lifetimeReplaySha256
guardianStartupSha256
guardianControlStateSha256
guardianRecoveryRequestFrameRawSha256
guardianRequestEofObserved
guardianStatusFrameRawSha256
inputSha256
authority
physicalFacts
nonclaims
```

The first printed constructor-record order is `inputArgumentFields`; the second
public projection block is `inputFields`. Neither includes an extra options,
metadata, or implementation-private placeholder field.

For `STATEFS_PLAN`, `statefsPlanSha256` and `ownerContextSha256` equal the exact
plan/context values; `statefsRequestSha256` is the plan's nullable request
digest. `lifetimeReplaySha256` is null when that context has no lifetime replay;
otherwise it is the
SHA-256 of repository-canonical JSON for the complete internally returned
ADR-0035 replay projection in its owner-defined field order. It binds bytes for
this manager input but never substitutes for the replay's private owner brand.
The two recovery-request digest fields are non-null only for
`RECOVERY_REQUEST_OBSERVED` and bind the exact ADR-0036 control state projection
(`guardianControlStateSha256` is its public `stateSha256`) and copied raw JSONL
frame respectively. `guardianRequestEofObserved` is primitive true only for
that input and null otherwise.

For a request-bearing `STATEFS_PLAN`, input construction additionally requires non-null
`currentState.nextStatefsRequestSequence`, exact equality between request and
state `managerActorEpochSha256`, exact equality between request sequence and
that next value, exact object identity between `request.inventorySet` and the
token privately retained for that state, and exact equality between request and
state `inventorySetSha256`. Reduction repeats all five checks before consuming
anything. A mutating or observation-only request additionally requires
`inventoryComplete: true`; an initial-traversal inventory/release request
requires false, while an exact mutation-pass reopen/release request requires
true and preserves that flag.
The manager does not accept a planner-produced request outside its exact plan,
and sequence exhaustion cannot be reset by a context plan, receipt, handoff, or
forked state. A context-only plan must carry the exact retained token/digest but
does not consume that token or increment the request sequence. Its manager
actor digest, `requestSequence`, inventory-token identity, and token digest
must equal the current state just as for a request plan; because every accepted
transition consumes that state, a context plan constructed against an earlier
state is stale and cannot later be submitted.

The digest fields are null when irrelevant. `inputSha256` covers every preceding
public field. Digesting an input never replaces the private full values. A PID,
path, cgroup name, lock report, standalone actor-resolution projection,
standalone recovery plan, or serialized projection is never sufficient.

Guardian wire-chain state is exact but does not misclassify manager-to-guardian
frames as statuses. Before a normal first status or a recovery request,
`guardianStartupSha256`, `recoveryRequestFrameRawSha256`,
`lastGuardianWireSequence`, and the last raw digest are null. Normal mode first
accepts only `NORMAL_READY` at wire sequence zero with the all-zero predecessor;
it stores sequence zero and that status digest. Recovery mode first accepts the
exact observed `RECOVERY_REQUEST` above at sequence zero/all-zero predecessor,
stores its raw digest in both digest fields, and only then accepts
`RECOVERY_REQUEST_ACCEPTED` at sequence one whose predecessor and
`recoveryRequestFrameSha256` both equal that exact request digest.

Every later status uses the same startup and follows one exact ADR-0036
sequence. When ADR-0036 emits a status directly after another status or a
synthetic input, its sequence is one greater and its predecessor is the retained
last wire digest. When a normal controller wire frame intervenes, the status's
sequence and predecessor are exactly the ADR-0036 row for that verified status,
including its embedded admission digest where applicable; the manager records
the newly accepted status sequence/digest but does not claim to have observed
the controller frame. Sequence must strictly increase and may not exceed five.
The exact status/state/terminal-reason/nullability table in ADR-0036 determines
the unique next scenario; zero or multiple matches reject. Replay, forking,
omission, byte-equal startup substitution, recovery acceptance without the
manager-bound request, and any structurally valid out-of-scenario frame are
`MANAGER_BINDING` before state consumption.

Statuses, in order, are exactly:

```text
LOCK_REQUIRED
LOCK_CONTENDED
INVENTORY_REQUIRED
INVENTORY_BLOCKED
REPLAY_REQUIRED
STATEFS_OPERATION_REQUIRED
GUARDIAN_HANDOFF_REQUIRED
WAITING_FOR_GUARDIAN
EFFECT_UNCERTAIN
TERMINAL
```

Writer kind is null or exactly `SERVICE_MANAGER`, `LIVE_BIRTH_GUARDIAN`, or
`RECOVERY_ONLY_GUARDIAN`; actor kind is null or exactly the latter two guardian
kinds. The module does not mint a lifetime record. It repeats only the exact
next writer, record type, and actor admitted by complete ADR-0035 replay and
same-origin selected boundaries.
`permittedGuardianAction` is null or exactly `NORMAL_CONTROL_HANDOFF`,
`RECOVERY_CONTROL_HANDOFF`, or `WAIT_STATUS`; no descriptor, signal, wait,
launch, or cgroup action is implied.

Both initialize and reduce return the transition schema, never a bare state.
Its exact ordered fields are:

```text
schema
previousStateSha256
inputSha256
state
statefsPlan
statefsRequest
guardianHandoffPlan
guardianRecoveryRequestArtifact
guardianStatusArtifact
transitionSha256
authority
physicalFacts
nonclaims
```

Initialization sets `previousStateSha256` to the all-zero digest,
`inputSha256`, `statefsPlan`, `statefsRequest`, `guardianHandoffPlan`, and
`guardianRecoveryRequestArtifact` and `guardianStatusArtifact` to null, and
returns the initial state above. Reduction
sets the two hashes to the consumed predecessor and input hashes; `statefsPlan`
is the exact consumed plan for every accepted `STATEFS_PLAN`, and
`statefsRequest` is its exact same branded nested request, without copy or
reconstruction, only when that plan is request-bearing;
`guardianRecoveryRequestArtifact` is non-null only
for the accepted recovery-request observation row; `guardianStatusArtifact` is
the exact verifier output only for an accepted `GUARDIAN_STATUS_FRAME`; all
three are otherwise null.
`transitionSha256` hashes repository-canonical JSON for exactly this ordered
null-prototype projection:

```text
schema
previousStateSha256
inputSha256
stateSha256
statefsPlanSha256
statefsRequestSha256
guardianHandoffPlanSha256
guardianRecoveryRequestArtifactSha256
guardianStatusArtifactRawSha256
```

The first three values are identical to the public transition. `stateSha256`
is `state.stateSha256`; each next value is null with its public object or is,
respectively, `statefsPlan.planSha256`, `statefsRequest.requestSha256`,
`guardianHandoffPlan.planSha256`,
`guardianRecoveryRequestArtifact.artifactSha256`, or
`guardianStatusArtifact.rawSha256`. No owner context or capability is
serialized, and each object binding occurs once. Public `transitionSha256`,
`authority`, `physicalFacts`, and `nonclaims` are absent from this projection.
Authority, physical facts, and nonclaims are the exact values below.

The module privately brands every returned transition in state `AVAILABLE`.
`assertCandidateContainmentGuardianManagerProtocolTransitionV1` first validates
the complete exact same-origin association and `AVAILABLE` state. For a nested
statefs request, that validation requires its object identity to equal the
public `transition.statefsRequest` and its manager-actor digest and sequence to
equal the privately retained consumed predecessor state's manager actor and
next-request sequence. The assertion then
synchronously changes that private state to `CONSUMED` and returns primitive
true. A foreign, malformed, or already-consumed transition throws
`MANAGER_BINDING` and changes no private state. Every transition, including an
initial, statefs-request, guardian-handoff, guardian-status, or terminal
transition, is a one-use owner handoff: inspection is not assertion, assertion
for testing consumes it, and no copy, digest, public field, or second call can
restore or reuse it. The authenticated dispatch view is exactly that same
recursively frozen transition after the assertion returns true; the assertion
does not return or mint a second view or capability.

ADR-0038 must accept that exact transition, never a bare request or digest. Its
single transition-consumer entrypoint treats the argument as opaque and calls
the manager assertion before reading, enumerating, copying, proxy-reflecting,
or otherwise accessing any caller property; the assertion first performs only
private WeakMap identity lookup and rejects a foreign object without property
access. Only after successful atomic consumption may ADR-0038 read the exact
recursively frozen transition. It then resolves and validates all
descriptor-map entries, buffers, and native request fields, requires the
request object it is about to dispatch to be identical to
`transition.statefsRequest`, calls
`assertCandidateContainmentGuardianStatefsRequestV1` exactly once, and invokes
the C executor immediately with no intervening fallible adapter action. A
guardian-handoff transition is likewise consumed before any field access,
prepared only inside that one consumer call, and submitted to exactly one
external handoff before the call returns. A
status-only, initialization, or terminal transition is asserted once before
the owning caller accepts its state/evidence and authorizes no physical action.
Assertion rejection leaves a same-origin available transition unchanged only
when validation fails before the `AVAILABLE`-to-`CONSUMED` update; any mapping,
preparation, nested-request assertion, or other failure after successful
consumption is terminal for that manager instance and permits neither retry nor
external effect from that transition. ADR-0038 exposes no entrypoint accepting
an already-extracted request, handoff plan, or public field set, so every
external attempt must pass through the one-shot transition assertion. Thus an arbitrary
successful call to the public stateless planner cannot reach either executor or
guardian-handoff boundary.

`guardianHandoffPlan` is null except when the resulting status is
`GUARDIAN_HANDOFF_REQUIRED`. Its exact ordered fields are `schema`, `mode`,
`action`, `managerActorEpochSha256`, `lifetimeEpochSha256`, `targetSha256`,
`recoveryActorEpochSha256`, `descriptorRoles`, `recoverySelection`,
`recoverySelectionSha256`, `planSha256`, `authority`, `physicalFacts`, and
`nonclaims`; schema is
`oxigraph.candidate-containment-guardian-manager-handoff-plan/v1`. `mode` is
`NORMAL` or `RECOVERY_ONLY`. `action` is respectively `NORMAL_CONTROL_HANDOFF` or
`RECOVERY_CONTROL_HANDOFF`. Normal roles, in descriptor-number order, are
`controllerChannel`, `statusWrite`, `diagnosticsWrite`, `stateRoot`,
`delegatedRoot`, `guardianLifetimeCgroup`, `epochRead`, and
`supervisorExecutable` for FDs 0 through 7. Recovery roles are
`recoveryRequestRead`, `statusWrite`, `diagnosticsWrite`, `stateRoot`,
`delegatedRoot`, `recoveryActorLifetimeCgroup`, and `epochRead` for FDs 0
through 6. Normal binds a non-null lifetime epoch and null target/recovery epoch,
and both recovery-selection fields are null. Recovery binds all three epochs,
and embeds the exact complete ADR-0036 recovery selection constructed from the
privately retained, same-origin verified attempt/target/lifecycle-inventory/
recovery-replay/plan/lifetime-anchor tuple. `recoverySelectionSha256` is the
SHA-256 of repository-canonical JSON for that complete selection. `planSha256`
hashes every preceding field.
The plan contains no descriptor integer or physical-FD claim; ADR-0038 alone
may resolve these fixed roles to held descriptors.

The recovery selection has exactly ADR-0036's ordered fields: `schema`,
`targetSha256`, `recoveryRequirementsSha256`, `recoveryPlanSha256`,
`recoveryReplaySha256`, `lifecycleInventorySha256`, `attemptSha256`,
`planStatus`, `requiredActorKind`, `actorKind`,
`recoveryActorEpochSha256`, `attemptDirectoryName`,
`lifetimeAnchorProjectionSha256`, `lifetimeAttemptAnchorRawSha256`,
`disposition`, `quarantineReason`, `sourceLocation`,
`decisionSourceLocation`, `requiredDestinationLocation`, `stateCount`, and
`state0` through `state18`. Its schema, literal/nullability rules, digest
preimages, state count/slots, locations, actor, disposition, and quarantine
reason are exactly the pinned ADR-0036 contract. The manager deterministically
constructs that selection from the exact owner context returned by the
consuming statefs plan assertion and rejects any field unequal to the plan or
context. Statefs's private plan association, not a second manager-side owner
verifier, is the proof that the source tuple was complete and same-origin.
The selection is serializable data, not the private predecessor capability;
the handoff plan's private association retains the verified tuple.

`guardianRecoveryRequestArtifact` has exactly these ordered fields:

```text
bytes
controlInput
schema
guardianHandoffPlanSha256
startupSha256
controlStateSha256
recoverySelectionSha256
recoveryRequestFrameRawSha256
artifactSha256
authority
physicalFacts
nonclaims
```

Its schema is
`oxigraph.candidate-containment-guardian-manager-recovery-request-artifact/v1`.
`bytes` is a copy-on-read view of the exact canonical JSONL request and
`controlInput` is the exact branded value returned by
`createCandidateContainmentGuardianRecoveryRequestInputV1`; neither is included
in a canonical manager projection. `artifactSha256` is the SHA-256 of
repository-canonical JSON for the exact null-prototype record with ordered keys
`schema`, `guardianHandoffPlanSha256`, `startupSha256`, `controlStateSha256`,
`recoverySelectionSha256`, and `recoveryRequestFrameRawSha256`, taking the six
identical public values. The capability fields and later digest, authority,
physical-fact, and nonclaim fields are omitted. The request frame has ADR-0036's exact
ordered fields `schema`, `action`, `mode`, `sequence`,
`previousFrameSha256`, `requirementsSha256`, `startupSha256`, `epochSha256`,
`recoverySelectionSha256`, and `recoverySelection`: action
`RECOVERY_REQUEST`, mode `RECOVERY_ONLY`, sequence zero, all-zero predecessor,
the imported guardian-control requirements digest, the exact startup raw
digest, startup epoch equal to the plan's recovery actor epoch, and the plan's
exact selection/digest. It ends in exactly one LF and is at most 32,768 bytes.

On `RECOVERY_REQUEST_OBSERVED`, the manager requires the exact caller-supplied
ADR-0036 startup projection matching the retained handoff plan, and an ADR-0036 initial recovery control state whose public
fields are mode `RECOVERY_ONLY`, phase `WAITING_RECOVERY_REQUEST`, next wire
sequence zero, all-zero last-wire digest, event/count fields zero, and whose
startup/epoch/requirements digests match the plan. It independently constructs
the request bytes above and requires byte equality to the copied observed frame,
then calls the ADR-0036 constructor with that exact control state, bytes, and
primitive EOF observation `true`. Constructor rejection is
`MANAGER_PREDECESSOR`; success returns the artifact, binds its raw digest to the
plan digest and manager successor state, and grants no claim that a byte was
written, read, or closed.

The transition table is total. In the compact result notation
`S(status,writer,actor,target,durable,operation,guardian,outcome,plan,request,
uncertain,retry,terminal)`, the arguments after `status` populate, in order,
the state fields `writerKind`, `actorKind`, `targetSha256`,
`requiredDurableRecordType`, `permittedStatefsOperation`,
`permittedGuardianAction`, `requiredOutcomeRecordType`,
`statefsPlanSha256`, `statefsRequestSha256`, `unresolvedEffect`,
`retryPermitted`, and `terminal`.
`N` means primitive null, `F` false, and `T` true. `SM`, `LG`, and `RG` mean the
three exact writer/actor strings in their requirements order. `PL.field`,
`RQ.field`, and `RC.field` mean the identically named field of the exact branded
plan, its nested request, or receipt. Every accepted row increments state
sequence; only a request-bearing plan row also increments
`nextStatefsRequestSequence`. Manager epoch never changes.

| Current status / retained operation                                                          | Exact input predicate                                                                                                                                                                                                          | Exact result                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOCK_REQUIRED`                                                                              | request-bearing `STATEFS_PLAN`; next sequence; `RQ.operation=LOCK_EX_NB`; `PL.inventorySet=null`; owner context all null                                                                                                       | `S(STATEFS_OPERATION_REQUIRED,SM,N,N,N,LOCK_EX_NB,N,N,PL.planSha256,RQ.requestSha256,F,F,F)` and transition exposes `PL`/`RQ`                                                                                                   |
| `STATEFS_OPERATION_REQUIRED/LOCK_EX_NB`                                                      | `STATEFS_RECEIPT`; `RC.request` is retained; `RC.outcome=LOCK_HELD`; exact root observation and empty revision-zero token                                                                                                      | `S(INVENTORY_REQUIRED,SM,N,N,N,INVENTORY,N,N,N,N,F,F,F)` and installs that token/digest plus the singleton root handle/count                                                                                                    |
| `STATEFS_OPERATION_REQUIRED/LOCK_EX_NB`                                                      | `STATEFS_RECEIPT`; retained request; `RC.outcome=LOCK_CONTENDED`; no successor token                                                                                                                                           | `S(LOCK_CONTENDED,N,N,N,N,N,N,N,N,N,F,F,T)`                                                                                                                                                                                     |
| `INVENTORY_REQUIRED`                                                                         | request-bearing `STATEFS_PLAN`; next sequence; exact retained token; `RQ.operation=INVENTORY`                                                                                                                                  | `S(STATEFS_OPERATION_REQUIRED,SM,N,N,N,INVENTORY,N,N,PL.planSha256,RQ.requestSha256,F,F,F)` and transition exposes `PL`/`RQ`                                                                                                    |
| `INVENTORY_REQUIRED`                                                                         | request-bearing `STATEFS_PLAN`; next sequence; exact retained token; `RQ.operation=RELEASE_DIRECTORY` and context identifies the exact nonroot DFS top                                                                         | `S(STATEFS_OPERATION_REQUIRED,SM,N,N,N,RELEASE_DIRECTORY,N,N,PL.planSha256,RQ.requestSha256,F,F,F)` and transition exposes `PL`/`RQ`                                                                                            |
| `STATEFS_OPERATION_REQUIRED/INVENTORY` with `inventoryComplete=false`                        | `STATEFS_RECEIPT`; retained request; `RC.outcome=INVENTORY_OBSERVED`; inventory/token exact and safe; traversal work remains                                                                                                   | `S(INVENTORY_REQUIRED,SM,N,N,N,INVENTORY,N,N,N,N,F,F,F)` with updated count/map/token and complete false                                                                                                                        |
| `STATEFS_OPERATION_REQUIRED/INVENTORY` with `inventoryComplete=false`                        | same, traversal work empty except retained root                                                                                                                                                                                | `S(REPLAY_REQUIRED,SM,N,N,N,N,N,N,N,N,F,F,F)` with updated count/map/token and complete true                                                                                                                                    |
| `STATEFS_OPERATION_REQUIRED/INVENTORY`                                                       | `STATEFS_RECEIPT`; `RC.retryDisposition=NO_RETRY`, `RC.outcome=REJECTED`, and null successor for unsafe, aliased, residue, over-bound, or drifted inventory; every binding/token defect throws before a row                    | `S(INVENTORY_BLOCKED,N,N,N,N,N,N,N,N,N,F,F,T)`                                                                                                                                                                                  |
| `STATEFS_OPERATION_REQUIRED/RELEASE_DIRECTORY` with `inventoryComplete=false`                | retained exact complete receipt/same-map successor; pending DFS work remains                                                                                                                                                   | `S(INVENTORY_REQUIRED,SM,N,N,N,INVENTORY,N,N,N,N,F,F,F)` with popped handle/successor token                                                                                                                                     |
| `STATEFS_OPERATION_REQUIRED/RELEASE_DIRECTORY` with `inventoryComplete=false`                | same, no pending work and only root remains                                                                                                                                                                                    | `S(REPLAY_REQUIRED,SM,N,N,N,N,N,N,N,N,F,F,F)` with popped handle, complete true                                                                                                                                                 |
| `REPLAY_REQUIRED`                                                                            | request-bearing `STATEFS_PLAN`; next sequence; exact current token; statefs owner context uniquely selects any inventory/release/mutation/persistence request                                                                  | `S(STATEFS_OPERATION_REQUIRED,RQ.writerKind,RQ.actorKind,RQ.targetSha256,RQ.requiredDurableRecordType,RQ.operation,N,RQ.requiredOutcomeRecordType,PL.planSha256,RQ.requestSha256,F,F,F)` and transition exposes `PL`/`RQ`       |
| `STATEFS_OPERATION_REQUIRED/INVENTORY` or `/RELEASE_DIRECTORY` with `inventoryComplete=true` | retained exact complete receipt and exact successor token for mutation-pass open/release                                                                                                                                       | `S(REPLAY_REQUIRED,SM,N,N,N,N,N,N,N,N,F,F,F)` with updated map/token/handle stack and complete true                                                                                                                             |
| `REPLAY_REQUIRED`                                                                            | context-only `STATEFS_PLAN`; exact owner context; `managerDisposition=GUARDIAN_HANDOFF`                                                                                                                                        | `S(GUARDIAN_HANDOFF_REQUIRED,SM,PL.actorKind,PL.targetSha256,N,N,PL.guardianAction,N,PL.planSha256,N,F,F,F)` plus exact plan/context handoff                                                                                    |
| `REPLAY_REQUIRED`                                                                            | context-only `STATEFS_PLAN`; exact owner context; `managerDisposition=WAIT_GUARDIAN`                                                                                                                                           | `S(WAITING_FOR_GUARDIAN,N,PL.actorKind,PL.targetSha256,N,N,WAIT_STATUS,N,PL.planSha256,N,F,F,F)`                                                                                                                                |
| `REPLAY_REQUIRED`                                                                            | context-only `STATEFS_PLAN`; exact owner context; `managerDisposition=RECOVERY_REPLAN`                                                                                                                                         | `S(INVENTORY_REQUIRED,SM,N,PL.targetSha256,N,INVENTORY,N,N,PL.planSha256,N,F,F,F)` with count zero, complete false, retained token, singleton-root DFS reset                                                                    |
| `REPLAY_REQUIRED`                                                                            | context-only `STATEFS_PLAN`; exact owner context; `managerDisposition=TERMINAL`                                                                                                                                                | `S(TERMINAL,N,N,PL.targetSha256,N,N,N,N,PL.planSha256,N,F,F,T)`                                                                                                                                                                 |
| `STATEFS_OPERATION_REQUIRED` for a mutating/persistence request                              | retained exact `STATEFS_RECEIPT`; complete outcome, or observation-only `ALREADY_PRESENT_EXACT`, `DIRECTORY_ALREADY_PRESENT_EXACT`, `DESTINATION_ALREADY_PRESENT_EXACT`, or `TEMP_ALREADY_ABSENT`; exact successor token/delta | `S(REPLAY_REQUIRED,RC.writerKind,RC.actorKind,RC.targetSha256,N,N,N,N,N,N,F,F,F)` with successor token/map; a required outcome record is selected only by a later plan                                                          |
| any non-lock, non-release `STATEFS_OPERATION_REQUIRED`                                       | retained exact receipt; unchanged-map successor; `RC.outcome=FAILED_DEFINITE_NO_EFFECT`; `RC.retryDisposition=REPLAN_AFTER_FRESH_INVENTORY`                                                                                    | `S(INVENTORY_REQUIRED,SM,N,RC.targetSha256,N,INVENTORY,N,N,N,N,F,T,F)` with successor token, count zero, complete false, and singleton-root DFS reset pending                                                                   |
| any `STATEFS_OPERATION_REQUIRED`                                                             | retained exact receipt; mutation-not-fully-synced or effect-uncertain; successor null                                                                                                                                          | `S(EFFECT_UNCERTAIN,N,N,RC.targetSha256,N,N,N,N,N,N,T,F,T)`; a release request retires/pops the exact top handle already removed by the adapter                                                                                 |
| `STATEFS_OPERATION_REQUIRED/LOCK_EX_NB` or any non-inventory operation                       | retained exact non-success receipt not matched above; `RC.retryDisposition=NO_RETRY`; `RC.outcome=FAILED_DEFINITE_NO_EFFECT` or `REJECTED`; successor null                                                                     | `S(TERMINAL,N,N,RC.targetSha256,N,N,N,N,N,N,F,F,T)`; a release request retires/pops the exact top handle after the adapter's mandatory teardown                                                                                 |
| `GUARDIAN_HANDOFF_REQUIRED` with recovery plan and no bound request                          | `RECOVERY_REQUEST_OBSERVED`; exact ADR-0036 recovery startup/initial control state matching the plan's mode, requirements, and recovery actor epoch; sequence-zero request bytes and EOF observation                           | `S(GUARDIAN_HANDOFF_REQUIRED,N,current.actorKind,current.targetSha256,N,N,RECOVERY_CONTROL_HANDOFF,N,current.statefsPlanSha256,N,F,F,F)` and exposes the recovery-request artifact, retaining sequence 0/request digest/startup |
| `GUARDIAN_HANDOFF_REQUIRED` with normal plan                                                 | `GUARDIAN_STATUS_FRAME`; exact `NORMAL_READY`, sequence 0, zero predecessor, matching plan startup/epoch                                                                                                                       | `S(WAITING_FOR_GUARDIAN,N,current.actorKind,current.targetSha256,N,N,WAIT_STATUS,N,current.statefsPlanSha256,N,F,F,F)` and exposes verified artifact/normal wire prefix                                                         |
| `GUARDIAN_HANDOFF_REQUIRED` with recovery plan and bound request                             | `GUARDIAN_STATUS_FRAME`; exact `RECOVERY_REQUEST_ACCEPTED`, sequence 1, predecessor/request field equal retained request digest, matching plan                                                                                 | `S(WAITING_FOR_GUARDIAN,N,current.actorKind,current.targetSha256,N,N,WAIT_STATUS,N,current.statefsPlanSha256,N,F,F,F)` and exposes verified artifact/recovery wire prefix                                                       |
| `WAITING_FOR_GUARDIAN`                                                                       | `GUARDIAN_STATUS_FRAME`; exact next nonterminal `ADMISSION_ACCEPTED`, `CANCEL_REQUIRED`, or `RECOVERY_REQUIRED` in ADR-0036 scenario                                                                                           | `S(WAITING_FOR_GUARDIAN,N,current.actorKind,current.targetSha256,N,N,WAIT_STATUS,N,current.statefsPlanSha256,N,F,F,F)` and exposes artifact/advances wire prefix                                                                |
| `WAITING_FOR_GUARDIAN`                                                                       | `GUARDIAN_STATUS_FRAME`; exact next `CONTROL_TERMINAL` in ADR-0036 scenario                                                                                                                                                    | `S(REPLAY_REQUIRED,SM,N,current.targetSha256,N,N,N,N,N,N,F,F,F)` and exposes final artifact, then resets guardian-chain fields                                                                                                  |

Inventory and active-handle fields are outside the `S` abbreviation. Rows
entering initial `INVENTORY_REQUIRED` set count zero and complete false and
reset the DFS stack to the singleton root handle. The lock row installs the
receipt's empty revision-zero token/digest. A retry row installs the receipt's
unchanged-map successor token, resets the logical/adapter DFS stack to the
singleton root, resets `inventoryRequestCount` to zero and `inventoryComplete`
to false, and allows no next planner call until the teardown below has finished.
A recovery-replan row preserves the current
token until root inventory consumes it. The next root-inventory receipt replaces
the private current map and token with its exact singleton-root successor. An
inventory-request row otherwise preserves those values. Each accepted inventory receipt increments the count and replaces
the exact observed scope in a manager-private map. Its canonical projection is
a dense array in root-relative ASCII component-chain order; each element has
ordered fields `directoryHandleSha256`, `directoryIdentitySha256`,
`inventoryKind`, `requestedName`, and `inventorySha256`.
Directory inventory replaces the complete directory scope; regular-file
inventory replaces that one named scope. `inventorySetSha256` is the SHA-256 of
canonical JSON for that complete array—the identical preimage, order, and
digest algorithm used by the statefs token. A completed mutation receipt
applies its exact printed post-state delta before the next request; if its
observations do not determine a complete delta, the table can select only fresh
inventory or `EFFECT_UNCERTAIN`. Release and observation-only receipts change no
map entry but install their exact next-revision same-map token.

For every accepted receipt, the manager first requires `RC.request` to be the
exact retained request, `RC.previousInventorySet` to be the exact token retained
by the predecessor state, and both previous digests to equal that state's
public digest. It independently applies `RC.inventories`, recomputes the map
digest and scope count, and requires exact equality to the branded successor
token's public projection before storing that exact token. A row whose frozen
result requires no successor requires both successor fields null. These checks
and state/input/request consumption are one successful reduction: any mismatch
is `MANAGER_BINDING` or `MANAGER_TRANSITION`, consumes nothing, and exposes no
partial state. Serialized state, transition, task, log, receipt projection, or
attestation evidence carries only nullable inventory-set digests; it never
carries the capability token or private map.

Nested-directory inventory pushes the derived handle; release pops it. After
each such row, `activeDirectoryHandleCount` and
`activeDirectoryHandlesSha256` equal the exact root-to-leaf stack length and
SHA-256 of canonical JSON for its ordered handle-digest array. No accepted state
after a `LOCK_HELD` receipt may contain zero or more than five, a repeated
handle, or a stack inconsistent with the private DFS plan. Only the
pre-acquisition `LOCK_REQUIRED` and
`STATEFS_OPERATION_REQUIRED/LOCK_EX_NB` states and a terminal lock-failure
state have count zero and null digest. Every row with `terminal: true` after an
accepted lock clears the token/map, sets `inventoryComplete: false`, and retires
the logical stack to its singleton root before return. ADR-0038 then closes and
removes every nonroot adapter mapping in reverse stack order exactly once before
performing any external teardown; a context-only terminal plan and a
no-successor receipt use the same rule. Close results are diagnostic only and
cannot change the manager transition or prove physical closure. The initial safe rows set complete exactly as
printed; mutation-pass inventory/release preserves true. Every other row
preserves all five latest inventory/handle values unless its printed result says
otherwise. No caller supplies an inventory count, set, stack, or complete flag;
request and receipt `inventorySetSha256` must equal the consumed state's digest
before any update.

Guardian-chain fields are likewise outside `S`. A row entering
`GUARDIAN_HANDOFF_REQUIRED` resets startup, recovery-request digest, last wire
sequence, and last-frame digest to null. The recovery-request row sets all four
to its startup, request digest, zero, and request digest; the normal first-status
row sets startup/null/zero/status digest; the recovery first-status row advances
the latter prefix to sequence one/status digest without replacing the retained
request digest. Later status rows store the exact new sequence and digest. The
`CONTROL_TERMINAL` transition binds and exposes that final artifact, but its
successor `REPLAY_REQUIRED` state resets all four to null; a later handoff can
therefore accept only a new sequence-zero prefix, never continue the prior head.
Every non-guardian row otherwise preserves the current null quartet.

The plan disposition is not caller input. Statefs derives it in this exact
precedence after complete owner verification: a complete terminal tail is
`TERMINAL`; an ADR-0036 normal/recovery transfer is `GUARDIAN_HANDOFF`; a current
adopted actor with no manager-writable record is `WAIT_GUARDIAN`; an exact
terminal actor resolution, replacement, or proved-reboot prefix requiring a
root reset is `RECOVERY_REPLAN`; every uniquely admitted next immutable record,
directory creation, cleanup, lifecycle move (including state 18), sync-only
move completion, or traversal step is `STATEFS_REQUEST`. Zero or multiple
relationships throw `STATEFS_TRANSITION`. The manager requires the exact
statefs-asserted context object and its fields to match the plan/request, and copies the
writer, actor, target, record types, operation, outcome record, and guardian
action from that one plan. It does not inspect or recreate the selection rule.

Every current-status/input-kind pair not listed in the table, every predicate
mismatch within a listed pair, and every input to `LOCK_CONTENDED`,
`INVENTORY_BLOCKED`, `EFFECT_UNCERTAIN`, or `TERMINAL` throws
`MANAGER_TRANSITION` without consuming state or input. An owner-verifier,
brand, writer, or bound-state failure instead throws at its earlier exact error
precedence. This default plus the listed rows covers the complete status × input
kind product.

The manager never calls the C executor and never manufactures a statefs
request. The transition exposes the exact request to ADR-0038, which alone maps
it to the C ABI and returns it to statefs verification. A statefs receipt can
advance only its originating request and manager state. Lock contention closes
that protocol instance with `terminal: true` and `retryPermitted: false`; it has
no escape transition and grants no claim that the competing lock ended. A new
instance requires the external owner to make a new state-root observation and
attempt a new lock request under separately established authority.
`retryPermitted` is true only for an exact non-lock, non-release
definite-no-effect receipt
and means a fresh root-inventory plan/request and replan, never repeat of an old
syscall request.

The exact crash-prefix decisions are:

| Last complete durable/observed prefix                                  | Required response                                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| before intent                                                          | perform no physical mutation; recompute from complete replay                                                                                                                                                            |
| intent durable, no request/result                                      | inventory, then plan the one still-admitted operation                                                                                                                                                                   |
| request issued, no complete result                                     | inventory; accept only exact proved completion or definite no effect, otherwise `EFFECT_UNCERTAIN`                                                                                                                      |
| temporary created/written/read back/file-synced but final absent       | preserve residue, do not recast as empty; block or select separately authorized cleanup                                                                                                                                 |
| final installed but parent sync or reobservation absent                | no retry; `EFFECT_UNCERTAIN` even if the current name is present                                                                                                                                                        |
| directory created but child/parent sync absent                         | no retry; inventory and unresolved-effect handling                                                                                                                                                                      |
| generation moved but either parent sync/reobservation absent           | no second move; only `MOVE_SYNC_REOBSERVE` is permitted when complete fresh inventory, exact identity, and the durable move decision match; a surviving same-process unresolved receipt is optional additional evidence |
| complete physical receipt, outcome record absent                       | append only the matching outcome record with the original writer/actor                                                                                                                                                  |
| manager dies while guardian retains the shared lock                    | replacement manager does not reacquire, write, signal, wait, close, or adopt; it waits for exact guardian/lock resolution                                                                                               |
| manager and guardian are gone and lock is reacquired                   | require ADR-0035 replacement evidence, complete lifetime/recovery replay, cgroup observations from ADR-0038, and fresh statefs inventory before selecting anything                                                      |
| guardian dies before launch proof                                      | only exact same-manager definite-no-child or replacement partial-launch resolution may advance                                                                                                                          |
| live-birth guardian dies after adoption                                | service manager may write a result only after ADR-0035's exact terminal resolution or proved reboot; it never impersonates the guardian                                                                                 |
| recovery guardian dies after launch intent                             | require its exact pidfd/exec/membership prefix plus terminal resolution or proved reboot before manager-written result                                                                                                  |
| recovery-only anchor never launches before record-1 temporary creation | manager may select anchored-empty only from exact `ABSENT` or `PRESENT_EMPTY`; any residue blocks                                                                                                                       |
| state 18                                                               | no recovery actor; exact active-to-closed no-replace move or `MOVE_SYNC_REOBSERVE`, then branded close receipt                                                                                                          |

These rows reuse, without widening, ADR-0035's full writer table. The admission
guardian alone writes its live-birth adoption/target/attempt results while its
actor is current. A recovery guardian alone writes its adopted recovery
records/results while its exact launch and membership prefix is current. The
service manager alone writes lifetime-wide, launch-intent, definite-not-created,
termination, reap/parentage-lost, reboot, removal, close, and the narrowly
permitted post-resolution/anchored-empty records. The manager never appends a
guardian-only fact, mutates generation `ctl` or `job`, infers liveness from a
PID, or treats lock ownership as actor continuity. A guardian never creates or
removes its lifetime cgroup or takes manager wait authority.

Manager validation errors and precedence are exactly:

```text
MANAGER_BOUNDS
MANAGER_SHAPE
MANAGER_EPOCH
MANAGER_PREDECESSOR
MANAGER_BINDING
MANAGER_WRITER
MANAGER_TRANSITION
```

Each thrown message is one code with no dynamic detail, in that precedence.
Manager values use the same copy, own-data-property, null-prototype, recursive
freeze, private-brand, same-origin, and caller-mutation rules as statefs.

#### Exact manager requirements encoding

The manager requirements value uses the following exact ordered nested values;
field arrays are the verbatim ordered blocks above. `T01` through `T25` name the
twenty-five transition-table rows in printed order and `C01` through `C15` name the
fifteen crash-prefix rows below in printed order. The identifiers are stored as
literal strings and have no hidden extension point.

```text
predecessors = [
  [statefsV1RequirementsSha256,exact-imported-statefs-digest],
  [containmentExactV2GitBlob,8e59aae2ec200652ffa848c9d1a8ab31a2280c29],
  [journalV2RequirementsSha256,95a4311224d8dfa5f481436e87da4b4d5f56a00d67278e7ed0e931476b584e26],
  [lifetimeV1RequirementsSha256,764975dd915913db4c4e0fc7bee308f8cb830c5f972ac0b97355601e7ff1b773],
  [recoveryV1RequirementsSha256,180ad61eba6cbc82d7828c881494dff23a030bdda953d98b8ea42fc88e145874],
  [guardianControlV1RequirementsSha256,4306a64a108dd3537f5e6a6683f6615d59cab6e12d2c91ffbfb116a7439e9131]
]
importInventory = managerImportInventory
schemas = [
  [requirements,oxigraph.candidate-containment-guardian-manager-protocol-requirements/v1],
  [managerActorEpoch,oxigraph.candidate-containment-guardian-manager-actor-epoch/v1],
  [input,oxigraph.candidate-containment-guardian-manager-protocol-input/v1],
  [state,oxigraph.candidate-containment-guardian-manager-protocol-state/v1],
  [transition,oxigraph.candidate-containment-guardian-manager-protocol-transition/v1],
  [guardianHandoffPlan,oxigraph.candidate-containment-guardian-manager-handoff-plan/v1],
  [guardianRecoveryRequestArtifact,oxigraph.candidate-containment-guardian-manager-recovery-request-artifact/v1]
]
limits = [[managerActorEpochBytes,32],[transitionSequenceMaximum,2999999],
  [statefsRequestSequenceMaximum,999999],[inventoryRequestsMaximum,250000],
  [guardianStatusFrameBytes,8192],[guardianRecoveryRequestFrameBytes,32768],
  [guardianWireSequenceMaximum,5]]
inputKinds = [STATEFS_PLAN,STATEFS_RECEIPT,
  RECOVERY_REQUEST_OBSERVED,GUARDIAN_STATUS_FRAME]
statuses = [LOCK_REQUIRED,LOCK_CONTENDED,INVENTORY_REQUIRED,INVENTORY_BLOCKED,
  REPLAY_REQUIRED,STATEFS_OPERATION_REQUIRED,GUARDIAN_HANDOFF_REQUIRED,
  WAITING_FOR_GUARDIAN,EFFECT_UNCERTAIN,TERMINAL]
writerKinds = [SERVICE_MANAGER,LIVE_BIRTH_GUARDIAN,RECOVERY_ONLY_GUARDIAN]
actorKinds = [LIVE_BIRTH_GUARDIAN,RECOVERY_ONLY_GUARDIAN]
guardianActions = [NORMAL_CONTROL_HANDOFF,RECOVERY_CONTROL_HANDOFF,WAIT_STATUS]
statefsOutcomes = [LOCK_HELD,LOCK_CONTENDED,INVENTORY_OBSERVED,
  ALREADY_PRESENT_EXACT,PERSISTED,DIRECTORY_ALREADY_PRESENT_EXACT,
  DIRECTORY_CREATED,DESTINATION_ALREADY_PRESENT_EXACT,MOVED,
  MOVE_SYNC_COMPLETED,TEMP_ALREADY_ABSENT,TEMP_REMOVED,DIRECTORY_RELEASED,
  FAILED_DEFINITE_NO_EFFECT,FAILED_MUTATION_NOT_FULLY_SYNCED,
  FAILED_EFFECT_UNCERTAIN,REJECTED]
transitionTable = [T01,T02,T03,T04,T05,T06,T07,T08,T09,T10,
  T11,T12,T13,T14,T15,T16,T17,T18,T19,T20,T21,T22,T23,T24,
  T25]
crashPrefixTable = [C01,C02,C03,C04,C05,C06,C07,C08,C09,C10,
  C11,C12,C13,C14,C15]
errorPrecedence = [MANAGER_BOUNDS,MANAGER_SHAPE,MANAGER_EPOCH,
  MANAGER_PREDECESSOR,MANAGER_BINDING,MANAGER_WRITER,MANAGER_TRANSITION]
orderingRules = [manager-brand-before-executor/v1,exact-next-request-sequence/v1,
  inventory-depth-first/v1,intent-before-statefs/v1,
  statefs-before-outcome/v1,guardian-writer-separation/v1,
  transition-one-shot-dispatch/v1,crash-prefix-no-retry/v1,
  terminal-consumes-state/v1]
```

`exact-imported-statefs-digest` above denotes the actual 64-byte lowercase
exported statefs digest value placed in that pair, not those words. The
`managerImportInventory` reference is the deep-copied exact dense array printed
above, not a string, live reference, or executable expression. The
requirements object's `epochFields`, `stateFields`, `inputArgumentFields`, `inputFields`,
`transitionFields`, `handoffPlanFields`, and `recoveryRequestArtifactFields` are
the exact printed field arrays. `transitionRuleFields` and
`crashPrefixRuleFields` are respectively
`[id,currentStatusOrOperation,inputPredicate,result]` and
`[id,lastCompletePrefix,requiredResponse]`. Each `Txx` or `Cxx` above is the
null-prototype record formed from its row in printed order: `id` is that exact
identifier, and every other value is the exact UTF-8 cell text after removing
only the one leading and one trailing ASCII space adjacent to the Markdown
separator; code-span backticks and all internal spaces remain literal. Thus the
requirements value contains the full rows and no hidden or normalized fixture.
Authority, physical facts, and nonclaims are the exact values below.

### Attestation and build contract

`containment-guardian-statefs-syscalls-attestation-v1.mjs` has exactly three
named exports:

```text
CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_BUILD_REQUIREMENTS
CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_SYSCALLS_V1_BUILD_REQUIREMENTS_SHA256
attestCandidateContainmentGuardianStatefsSyscallsV1({
  repositoryRoot, privateBuildRoot, buildKind
})
```

`buildKind` is exactly `PRODUCTION` or `FAULT`. Both roots must be absolute,
non-symlink directories; the private build root must be outside the source tree
and owner mode `0700`. The function resolves the fixed header/source paths from
`repositoryRoot`, opens the fixed compiler pathname `/usr/bin/cc` once, resolves
and records its regular-file identity,
SHA-256, and `--version` bytes, and invokes no shell. It accepts no compiler,
flag, environment, source, output-name, callback, or command override.

Compiler identity capture is one exact child invocation before any compile. Its
argv is the two-element dense string array `[compilerRealpath,--version]`, where
argv[0] is the recorded absolute realpath; cwd is `repositoryRoot`; its
environment is the exact four-entry environment frozen below; no stdin byte is
supplied; and no shell participates. The child must exit with code zero and no
signal, write zero stderr bytes, and write 1 through 65,536 stdout bytes.
`compilerVersionByteLength` and `compilerVersionSha256` bind those stdout bytes
verbatim, including every space and terminal LF; the module neither trims,
normalizes, concatenates streams, nor adds a byte. Each of the two production
compiles and optional fault compile likewise must exit zero with no signal and
empty stdout/stderr; otherwise attestation throws `STATEFS_ATTEST_COMPILER` for
the version child or `STATEFS_ATTEST_BUILD` for a compile child.

The build-requirements schema is
`oxigraph.candidate-containment-guardian-statefs-syscalls-build-requirements/v1`.
That recursively frozen value has exact ordered fields `schema`, `version`,
`platform`, `header`, `source`, `entrypoint`, `outputObjects`, `limits`, `abi`,
`productionArgv`, `faultArgvDelta`, `environment`, `pathRules`, `allowedSyscalls`,
`elfRules`, `reportFields`, `repeatCount`, `authority`, `physicalFacts`, and
`nonclaims`; version is integer `1`, platform
is `linux-x86_64-sysv-little-endian`, and repeat count is `2`. Its exported
digest is the canonical semantic SHA-256 computed under the same rule as the
two pure modules.

The attestation report schema is
`oxigraph.candidate-containment-guardian-statefs-syscalls-attestation/v1` and
has exactly these ordered fields:

```text
schema
requirementsSha256
buildKind
platform
compilerRealpath
compilerByteLength
compilerSha256
compilerVersionByteLength
compilerVersionSha256
firstProductionArgv
secondProductionArgv
faultArgv
environment
headerByteLength
headerSha256
sourceByteLength
sourceSha256
firstObjectByteLength
firstObjectSha256
secondObjectByteLength
secondObjectSha256
repeatedObjectBytesEqual
faultObjectByteLength
faultObjectSha256
faultInspection
elfClass
elfData
elfType
elfMachine
definedGlobalSymbols
undefinedSymbols
pltEntries
relocationTargets
gnuStackExecutable
writableExecutableSectionCount
directSyscallInstructionCount
observedSyscallNumbers
abiLayoutSha256
faultSelectorPresent
reportSha256
authority
physicalFacts
nonclaims
```

For both build kinds, the first and second objects are production builds whose
identities are non-null and equal,
`repeatedObjectBytesEqual` is true, defined globals is the singleton entrypoint,
undefined symbols and PLT entries are empty, GNU stack is false, writable-
executable count is zero, observed syscall numbers are the sorted unique numeric
Linux x86-64 values for the exact allowlist, and the flat
`faultSelectorPresent` is false because all flat ELF fields describe the first
production object. For `PRODUCTION`, both `faultObject*` fields and
`faultInspection` are null and no fault compilation occurs. For `FAULT`, the
fault object fields are non-null, its bytes differ from both production objects,
and `faultInspection` is the separately inspected fault record frozen below.
`firstProductionArgv` and `secondProductionArgv` differ only in their exact
output pathname. `faultArgv` is null for `PRODUCTION` and the exact fault argv
for `FAULT`.
`abiLayoutSha256` is the SHA-256 of repository-canonical JSON for the exact
three-element dense array `[abi[0],abi[1],abi[2]]` printed in the build
requirements below, without a trailing LF; the separate `abi[3]` return-value
rule remains covered by the complete build-requirements digest. Before
returning that layout digest, attestation independently parses the
header's declarations and every required `_Static_assert`, requires exact field
name/type/order/offset/alignment/size equality to that value, and requires both
objects to have been compiled from those accepted header bytes. The production
and fault reports therefore carry the same expected-and-observed layout digest;
hashing an implementation-selected compiler dump, table text, or object bytes
is forbidden.
`reportSha256` covers every preceding field. Exact thrown messages, in
precedence order, are
`STATEFS_ATTEST_BOUNDS`, `STATEFS_ATTEST_SHAPE`, `STATEFS_ATTEST_PATH`,
`STATEFS_ATTEST_COMPILER`, `STATEFS_ATTEST_BUILD`, `STATEFS_ATTEST_ELF`,
`STATEFS_ATTEST_ABI`, and `STATEFS_ATTEST_FAULT`.

The fault-inspection schema is
`oxigraph.candidate-containment-guardian-statefs-syscalls-fault-inspection/v1`.
Its exact ordered fields are `schema`, `objectSha256`, `elfClass`, `elfData`,
`elfType`, `elfMachine`, `definedGlobalSymbols`, `undefinedSymbols`,
`pltEntries`, `relocationTargets`, `gnuStackExecutable`,
`writableExecutableSectionCount`, `directSyscallInstructionCount`,
`observedSyscallNumbers`, `abiLayoutSha256`, `faultSelectorPresent`, and
`inspectionSha256`. It obeys the same array bounds and ELF rules, except
`faultSelectorPresent` is true and the one fault-selector branch is permitted;
its inspection digest covers every preceding field. This nested value is the
only report field describing the fault object.

Every path/argv element is at most 4,096 bytes; argv has at most 64 elements and
the environment exactly four. Compiler-version capture is at most 65,536 bytes;
header, source, each object, and the canonical report are each at most 1,048,576
bytes. ELF parsing admits at most 256 sections, 512 symbols, and 4,096
relocations before iteration. Symbol and relocation-target arrays are dense,
duplicate-free raw-ASCII-sorted strings; undefined and PLT arrays are exactly
empty, and every relocation target resolves to a defined local symbol or a
nonwritable section in the same object. Production and fault objects each
contain exactly 13 direct `syscall` instructions whose immediately loaded
numbers are the exact sorted allowlist; an indirect or data-derived syscall
number rejects. All bounds are checked before proportional allocation or ELF
iteration.

The production argument vector, after the recorded compiler path, is exactly:

```text
-std=c17 -O2 -fPIC -fvisibility=hidden -fno-common -fno-strict-aliasing
-fno-stack-protector -fno-builtin -Wall -Wextra -Werror
-Wconversion -Wsign-conversion -Wshadow -Wformat=2 -Wundef -Wvla
-Wcast-align=strict -Wstrict-prototypes -Wmissing-prototypes
-ffile-prefix-map=<repositoryRoot>=. -fdebug-prefix-map=<repositoryRoot>=.
-c tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-v1.c
-o <outputObject>
```

`<repositoryRoot>` and `<privateBuildRoot>` denote the exact resolved arguments,
not literal shell expansion. The argv executable is the recorded realpath of
`/usr/bin/cc`; no search path participates. The fault build inserts exactly
`-DOXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS=1` immediately before `-c` and uses
the basename `containment-guardian-statefs-syscalls-v1-fault.o`. The exact
`<outputObject>` substitutions are, in build order:

```text
<privateBuildRoot>/production-0001/containment-guardian-statefs-syscalls-v1.o
<privateBuildRoot>/production-0002/containment-guardian-statefs-syscalls-v1.o
<privateBuildRoot>/fault-0001/containment-guardian-statefs-syscalls-v1-fault.o
```

The third path and compile are absent for `PRODUCTION`. At entry,
`privateBuildRoot` must exist, be empty, be owned by the effective UID and GID,
and have mode `0700`. With umask `077`, the module creates each required child
directory in the printed order with `mkdir` mode `0700` and no replacement;
any pre-existing entry, collision, symlink, non-directory, ownership/mode drift,
or creation failure is `STATEFS_ATTEST_PATH`. Every compiler child has exact
working directory `repositoryRoot`; relative source arguments therefore resolve
only there. The module does not reuse, discover, clean, rename, or choose another
build path. The child
environment is exactly `LC_ALL=C`, `LANG=C`, `TZ=UTC`, and
`SOURCE_DATE_EPOCH=0`; no `PATH` or other inherited variable is present. The
compiler is invoked by absolute path. Umask is `077`.

Production is compiled twice into fresh directories. Header/source bytes,
compiler identity, argument vector, environment, both object bytes, ELF64
little-endian relocatable identity, AMD64 machine, section inventory, sole
defined global symbol, zero undefined symbols/PLT entries, relocation targets,
GNU-stack nonexecution, absence of writable-executable sections, direct-syscall
instruction sites, allowlisted syscall immediates, ABI layout, and absence of
fault code are independently inspected. The two objects must be byte-identical.
The fault object is separately identified and must differ. Attestation returns
an exact recursively frozen report whose canonical digest binds every one of
those fields; it grants no link, runtime, production, or qualification
authority.

The deliberate `-fno-stack-protector -fno-builtin` pair keeps this separately
linked object free of compiler-inserted libc/PLT dependencies. The source uses
no variable-length or fixed local byte array: directory enumeration uses the
validated caller output area as its 32,768-byte scratch region, and all other
copies use bounded scalar loops. The evaluator rejects any stack allocation
larger than 256 bytes, any undefined symbol, and any compiler-generated call.
This narrow object constraint is not a general recommendation for native
Oxigraph code.

The build requirements' nested value is exactly the following ordered
null-prototype data. `REQ_ROOT`, `BUILD_ROOT`, and `OUTPUT_OBJECT` are the three
literal template tokens stored in the requirements value; attestation replaces
them only with the validated resolved paths described above when forming a
reported argv.

```text
platform = linux-x86_64-sysv-little-endian
header = tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-v1.h
source = tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-v1.c
entrypoint = oxigraph_containment_statefs_execute_v1
outputObjects = [
  BUILD_ROOT/production-0001/containment-guardian-statefs-syscalls-v1.o,
  BUILD_ROOT/production-0002/containment-guardian-statefs-syscalls-v1.o,
  BUILD_ROOT/fault-0001/containment-guardian-statefs-syscalls-v1-fault.o
]
limits = [[pathBytes,4096],[compilerVersionBytes,65536],
  [headerBytes,1048576],[sourceBytes,1048576],[objectBytes,1048576],
  [argvElements,64],[argvElementBytes,4096],[environmentEntries,4],
  [elfSections,256],[elfSymbols,512],[elfRelocations,4096],
  [reportCanonicalBytes,1048576],[directSyscallInstructions,13]]
abi = [
  [request,[alignment,8,size,192,fields,[
    [abi_version,uint32_t,0],[struct_size,uint32_t,4],
    [operation,uint32_t,8],[inventory_kind,uint32_t,12],
    [dirfd_a,int32_t,16],[dirfd_b,int32_t,20],
    [dirfd_a_role,uint32_t,24],[dirfd_b_role,uint32_t,28],
    [name_a_length,uint32_t,32],[name_b_length,uint32_t,36],
    [input_length,uint64_t,40],[name_a_address,uint64_t,48],
    [name_b_address,uint64_t,56],[input_address,uint64_t,64],
    [observations_address,uint64_t,72],[observation_capacity,uint32_t,80],
    [output_capacity,uint32_t,84],[output_address,uint64_t,88],
    [test_fault_selector,uint32_t,96],[expected_owner_uid,uint32_t,100],
    [expected_owner_gid,uint32_t,104],
    [inventory_directory_role,uint32_t,108],
    [expected_mount_id_a,uint64_t,112],[expected_mount_id_b,uint64_t,120],
    [expected_device_major_a,uint64_t,128],
    [expected_device_minor_a,uint64_t,136],[expected_inode_a,uint64_t,144],
    [expected_filesystem_magic_a,uint64_t,152],
    [expected_device_major_b,uint64_t,160],
    [expected_device_minor_b,uint64_t,168],[expected_inode_b,uint64_t,176],
    [expected_filesystem_magic_b,uint64_t,184]
  ]]],
  [observation,[alignment,8,size,384,fields,[
    [struct_size,uint32_t,0],[kind,uint32_t,4],[role,uint32_t,8],
    [name_length,uint32_t,12],[device_major,uint64_t,16],
    [device_minor,uint64_t,24],[inode,uint64_t,32],[mount_id,uint64_t,40],
    [byte_length,uint64_t,48],[link_count,uint64_t,56],
    [mode,uint32_t,64],[owner_uid,uint32_t,68],[owner_gid,uint32_t,72],
    [statx_mask,uint32_t,76],[filesystem_magic,uint64_t,80],
    [content_offset,uint64_t,88],[content_length,uint64_t,96],
    [name,uint8_t[256],104],[reserved_0,uint64_t,360],
    [reserved_1,uint64_t,368],[reserved_2,uint64_t,376]
  ]]],
  [result,[alignment,8,size,64,fields,[
    [abi_version,uint32_t,0],[struct_size,uint32_t,4],
    [operation,uint32_t,8],[status,uint32_t,12],
    [effect_class,uint32_t,16],[last_completed_step,uint32_t,20],
    [failed_step,uint32_t,24],[errno_value,int32_t,28],
    [observation_count,uint32_t,32],[output_length,uint32_t,36],
    [completed_step_count,uint32_t,40],[returned_directory_fd,int32_t,44],
    [bytes_consumed,uint64_t,48],[reserved_u64,uint64_t,56]
  ]]],
  [return,[resultProduced,0,fixedBoundaryFailure,-1]]
]
productionArgv = [/usr/bin/cc,-std=c17,-O2,-fPIC,-fvisibility=hidden,
  -fno-common,-fno-strict-aliasing,-fno-stack-protector,-fno-builtin,
  -Wall,-Wextra,-Werror,-Wconversion,-Wsign-conversion,-Wshadow,
  -Wformat=2,-Wundef,-Wvla,-Wcast-align=strict,-Wstrict-prototypes,
  -Wmissing-prototypes,-ffile-prefix-map=REQ_ROOT=.,
  -fdebug-prefix-map=REQ_ROOT=.,-c,
  tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-v1.c,
  -o,OUTPUT_OBJECT]
faultArgvDelta = [insert-before-c,-DOXIGRAPH_CONTAINMENT_STATEFS_TEST_FAULTS=1]
environment = [[LC_ALL,C],[LANG,C],[TZ,UTC],[SOURCE_DATE_EPOCH,0]]
pathRules = [[repositoryRoot,absolute-existing-nonsymlink-directory],
  [privateBuildRoot,absolute-empty-owner-0700-nonsymlink-outside-repository],
  [childDirectories,[production-0001,production-0002,fault-0001]],
  [childDirectoryMode,0700],[umask,0077],[compiler,/usr/bin/cc],
  [cwd,repositoryRoot],[pathSearch,false]]
allowedSyscalls = [[read,0],[write,1],[close,3],[fcntl,72],
  [flock,73],[fsync,74],[fstatfs,138],[getdents64,217],[openat,257],
  [mkdirat,258],[unlinkat,263],[renameat2,316],[statx,332]]
elfRules = [[class,ELF64],[data,LSB],[type,REL],[machine,AMD64],
  [definedGlobals,[oxigraph_containment_statefs_execute_v1]],
  [undefinedSymbols,[]],[pltEntries,[]],[gnuStackExecutable,false],
  [writableExecutableSectionCount,0],[maximumStackAllocationBytes,256],
  [relocationTargetRule,defined-local-or-nonwritable-section-only],
  [directSyscallInstructionCount,13],[faultCodeInProduction,false],
  [repeatedProductionBytesEqual,true]]
reportFields = [schema,requirementsSha256,buildKind,platform,
  compilerRealpath,compilerByteLength,compilerSha256,
  compilerVersionByteLength,compilerVersionSha256,firstProductionArgv,
  secondProductionArgv,faultArgv,environment,headerByteLength,headerSha256,
  sourceByteLength,sourceSha256,firstObjectByteLength,firstObjectSha256,
  secondObjectByteLength,secondObjectSha256,repeatedObjectBytesEqual,
  faultObjectByteLength,faultObjectSha256,faultInspection,
  elfClass,elfData,elfType,elfMachine,
  definedGlobalSymbols,undefinedSymbols,pltEntries,relocationTargets,
  gnuStackExecutable,writableExecutableSectionCount,
  directSyscallInstructionCount,observedSyscallNumbers,abiLayoutSha256,
  faultSelectorPresent,reportSha256,authority,physicalFacts,nonclaims]
repeatCount = 2
```

The template's `/usr/bin/cc` entry is replaced by its recorded realpath in each
reported argv. `BUILD_ROOT` identifies the validated empty root in path-rule
strings and `outputObjects`; it is not itself an argv element. `REQ_ROOT`,
`BUILD_ROOT`, and `OUTPUT_OBJECT`, every path, argv item, field name, type name,
enum, key, and other unquoted token in this block are exact ASCII strings unless
the following sentence assigns another type. Values inside `limits`, ABI
alignment/size/offset positions, syscall numbers, and `repeatCount` are
integers; `false`/`true` in path and ELF rules are Booleans; environment keys
and values are strings, including the one-byte string `0` for
`SOURCE_DATE_EPOCH`; `childDirectoryMode` is the four-byte string `0700`; and
`umask` is the four-byte string `0077`. The ordered report fields above,
three exact child-directory names, exact cwd, child environment, and build-kind
nullability complete the attestation requirements value; no nested property is
implementation-selected.

### Private-local-filesystem evidence profile

The profile observation schema is
`oxigraph.candidate-containment-guardian-statefs-private-filesystem-report/v1`.
Its exact ordered fields are:

```text
schema
requirementsSha256
platform
architecture
byteOrder
kernelRelease
effectiveUid
effectiveGid
stateRootName
runNonceSha256
stateRootDeviceMajor
stateRootDeviceMinor
stateRootInode
stateRootMountId
filesystemMagic
mountPointByteLength
mountPointRawSha256
mountOptions
cleanupAttempted
cleanupCompleted
cleanupErrno
reportSha256
authority
physicalFacts
nonclaims
```

`platform`, `architecture`, and `byteOrder` are the exact profile strings
`linux`, `x86_64`, and `little-endian`. `kernelRelease` is a nonempty raw-ASCII
string of at most 256 bytes copied from `uname(2)` before setup. `effectiveUid`
and `effectiveGid` are integers from 0 through 4,294,967,295 copied from the
evaluator process. The four state-root identity values and filesystem magic are
minimal unsigned decimal strings in the statefs domains above; inode and mount
ID are nonzero. `mountPointByteLength` is 1 through 4,096 and its digest covers
the decoded raw mount-point bytes, which are not exposed. `mountOptions` is a
dense, duplicate-free raw-ASCII-sorted array of one through 256 nonempty
strings, each at most 255 bytes. It is the set union of the selected
`/proc/self/mountinfo` row's comma-split mount-options and super-options after
the exact `\040`, `\011`, `\012`, and `\134` octal byte escapes are decoded;
any other backslash escape rejects. It must contain `rw` and not `ro`.
`cleanupAttempted` is true. `cleanupCompleted` is true with null
`cleanupErrno`, or false with the first cleanup errno as an integer from 1
through 4,095. `reportSha256` covers every preceding field. The common
authority, physical-facts, and nonclaims remain false/null; this local report
does not itself activate a product fact.

The evaluator profile is exactly Linux x86-64, one evaluator-created
owner-mode `0700` root on a single locally mounted filesystem,
with all operations relative to held descriptors. Accepted test filesystem
magic is exactly ext4 `0x0000ef53` or XFS `0x58465342`. The evaluator records
the exact report above, including effective UID and GID. A different, remote,
FUSE, overlay, network,
unclassified, or cross-mount filesystem is an unsupported profile, not a skip
converted to PASS.

The evaluator receives exactly one input record with ordered fields
`scratchParent` and `runNonceBytes` and has no default. `scratchParent` is an
absolute canonical UTF-8 string of 1 through 4,096 bytes with no NUL, `.`/`..`
component, repeated separator, or trailing separator; its final directory and
every traversed component are nonsymlinks, and the final directory has the
effective owner UID/GID and mode `0700`. `runNonceBytes` is an
intrinsic, unshared, non-resizable 32-byte view, copied before the path is read
and rejected when all zero. The evaluator claims no entropy or randomness. It
derives `runNonceSha256` from those exact bytes and the 85-byte child name
`.oxigraph-statefs-v1-<runNonceSha256>`. After copying the nonce and validating
the input record, it obtains kernel release and effective UID/GID before any
filesystem setup. It then opens the parent read-only, directory-only, CLOEXEC,
and no-follow; obtains the parent's complete identity and unique decoded
longest mountinfo match; and validates the selected options, filesystem magic,
and single local mount before creating a child. It calls `mkdirat` exactly once
for that name with mode `0700` under umask `077`; rejects `EEXIST` without
another name or retry; opens the child read-only, directory-only, and no-follow but without
`O_CLOEXEC`; verifies with `F_GETFD` that `FD_CLOEXEC` is clear; and uses that
exact close-on-exec-false held FD as `STATE_ROOT`. The parent scratch FD remains
CLOEXEC and never enters a statefs request. It cross-checks the child's mount
ID, device, filesystem magic, owner, type, and mode against the already selected
parent/mountinfo foundation; mismatch rejects. Other mount options are sorted
by raw ASCII bytes and recorded but do not imply qualification.
The two accepted magic numbers are the complete local-profile classifier;
remote, overlay, FUSE, network, bind-crossing, and any second mount ID reject.
The created child must remain the recorded owner UID/GID, mode `0700`, link count at least
two, nonsymlink, and descriptor-identical through final observation. Cleanup is
only descriptor-relative, no-follow, depth-first postorder deletion below that
exact held child. Cleanup first attempts one close for every candidate-held
descriptor in reverse-open order and records the first close errno while still
attempting each remaining close once. If any close fails, it performs no path
deletion. Otherwise, non-directory
entries use `unlinkat` without flags; a directory is removed with
`AT_REMOVEDIR` only after its bounded children; the state-root child is removed
last relative to the still-held parent. The evaluator never follows, renames,
or removes any sibling/ancestor. After the first cleanup traversal/open/unlink
error it performs no later path mutation, closes each cleanup-only descriptor
once in reverse-open order, records the first errno, and fails the profile. On
every cleanup exit, whether child cleanup succeeded or failed, it closes the
scratch-parent descriptor exactly once as the final cleanup operation. That
close cannot replace an earlier errno; if no earlier cleanup failed, its errno
becomes the first cleanup errno. Cleanup failure cannot change an earlier test
failure to pass.

Profile processing uses exact error strings, in precedence order,
`PRIVATE_FS_PROFILE_BOUNDS`, `PRIVATE_FS_PROFILE_SHAPE`,
`PRIVATE_FS_PROFILE_PATH`, `PRIVATE_FS_PROFILE_MOUNT`, and
`PRIVATE_FS_PROFILE_CLEANUP`. A pre-child failure creates no report and is a
FAIL, never a skip. The report-validity threshold is the successful child
open plus complete identity/owner/mode/mount cross-check: at that point every
non-cleanup report field is fixed. A failure after `mkdirat` but before that
threshold must attempt the same fail-closed cleanup by the retained parent/name
and then throw without a report because no null placeholder is legal. At and
after the threshold, cleanup and a full report are mandatory on success or
failure. The `setupRules`, `recordRules`, `cleanupRules`, limits,
child prefix/grammar, and exact report fields in the requirements value are the
complete procedure; an evaluator may not select another temporary-name,
mount-classification, recording, retry, or cleanup policy.

The profile exercises the exact operation sequences, collisions, unsafe
metadata, residue, bounds, immutable bytes, and before/after fault selectors.
It uses only disposable evaluator-owned paths and cleans them after recording
the final observation. It does not mutate protected operator runtime state. The
fault build is test-only and the production object must remain absent from
production registration and executables.

This profile can establish the syscalls and bytes observed during that one live
local run. It does not establish state-root provenance, mount-option stability,
historical execution after the process exits, kernel/filesystem correctness,
power-loss or device durability, remote-filesystem behavior, hostile same-UID
resistance, delegated-host qualification, or production suitability. Those
remain ADR-0039 concerns.

## Owned files

This ADR owns these new paths:

- `tools/engineering-harness/src/candidate/containment-guardian-statefs-v1.mjs`;
- `tools/engineering-harness/src/candidate/containment-guardian-manager-protocol-v1.mjs`;
- `tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-v1.h`;
- `tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-v1.c`;
- `tools/engineering-harness/src/candidate/containment-guardian-statefs-syscalls-attestation-v1.mjs`;
- `tools/engineering-harness/test/candidate-containment-guardian-statefs-v1.test.mjs`;
- `tools/engineering-harness/test/candidate-containment-guardian-statefs-v1-faults.test.mjs`;
- `tools/engineering-harness/test/candidate-containment-guardian-statefs-syscalls-v1.test.mjs`;
- `tools/engineering-harness/test/candidate-containment-guardian-statefs-syscalls-v1-faults.test.mjs`;
  and
- `tools/engineering-harness/test/candidate-containment-guardian-manager-protocol-v1.test.mjs`.

ADR-0035 retains ownership of journal-v1/v2, lifetime-v1, recovery-v1, their
fixtures, and their exact requirements digests. ADR-0038 owns native process and
cgroup mechanics. ADR-0039 owns host qualification and readiness activation.

## Nonclaims and authority boundary

Every requirements value, request, observation, receipt, epoch, manager input,
manager state, transition, attestation report, and private-filesystem report
carries the same exact
authority record, with these ordered fields and primitive `false` values:

```text
filesystemExecution
processExecution
cgroupMutation
runtimeRegistration
productExecution
g17Execution
qualification
readiness
promotion
publication
```

Every such value also carries the same exact physical-facts record, with these
ordered fields and primitive `null` values:

```text
stateRootOrigin
stateRootHeld
stateRootLocked
filesystemClassified
inventoryObserved
artifactPersisted
directoryCreated
generationMoved
temporaryRemoved
managerAlive
guardianAlive
actorContinuity
```

The exact ordered nonclaim strings are
`state-root-provenance`, `service-manager-identity`, `epoch-randomness`,
`historical-durability`, `power-loss-durability`, `remote-filesystem`,
`same-uid-tamper-resistance`, `process-liveness`, `cgroup-state`,
`descriptor-origin`, `post-acquisition-lock-continuity`,
`pidfd-or-wait-authority`, `application-output`, `COMMIT`,
`semantic-qualification`, `product-progress`, `runtime-registration`,
`production-readiness`, `promotion`, and `publication`. These arrays and records
are recursive null-prototype frozen values and their key/item order participates
in both requirements digests.

A later independently accepted private-filesystem integration run can evidence
the exact syscalls and current bytes/metadata observed during that run. The S0
document, pure modules, request/receipt values, source inspection, object
attestation, and one local run do not by themselves prove:

- crash, power-loss, storage-device, filesystem-flush, or remote-filesystem
  durability;
- historical receipt-last ordering reconstructed only from final files;
- post-acquisition `flock` continuity or detection of lock loss after the one
  successful acquisition call;
- state-root provenance, service-manager identity, epoch randomness, guardian
  execution, or actor continuity;
- delegated-cgroup identity or mutation, process placement, signalling,
  descriptor ownership, pidfd ownership, wait authority, exit status, or reap;
- application output, `COMMIT`, semantic qualification, or product progress; or
- production registration, G1.7 execution, qualification, promotion, or
  publication.

The modules are not a general filesystem transaction library. The initial
profile excludes NFS, SMB, unclassified filesystems, caller-selected roots, and
same-UID tamper-resistance claims. The S0 not-implemented state is historical;
the bounded candidate implementation described below is now present. ADR-0037
remains Proposed and production readiness remains exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`.

## 2026-09-05 S7 integrated candidate evidence

The S7 author freeze starts from exact commit
`4dbe7854a30ebe559cb918cf7cfe7780df3bc031`. Direct deterministic
application tests are the authority for this bounded repository claim;
MetaHarness plans, scores, and receipts remain diagnostic only. The ten owned
paths above are present and the five source artifacts have these exact SHA-256
identities:

| Artifact                                                   | SHA-256                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `containment-guardian-statefs-v1.mjs`                      | `5feccc9039c36d404e3097ee2c3da59ff1d3a319413deaf8e1c18ec9f80aa5e1` |
| `containment-guardian-manager-protocol-v1.mjs`             | `79c6dec19e6f7e1c68090dae36eab72b6c0f956f07b52ff0fa2d84b4f187b158` |
| `containment-guardian-statefs-syscalls-v1.h`               | `358abbcb75ee52e889f850e7d9a1eb68d6124af20963fbbf96e1f30c5ccd2a28` |
| `containment-guardian-statefs-syscalls-v1.c`               | `f0dd2f3d6944a1a81f31181ebec616669f2f8f21c52ad9d6799d1ba07ad63138` |
| `containment-guardian-statefs-syscalls-attestation-v1.mjs` | `09f016c0686289bb39cb52af52b120a94e3de4c338cf8f1b72e834a3ab56a779` |

The direct matrix binds the unchanged journal-v2, lifetime-v1, recovery-v1,
StateFS, and manager requirements digests respectively as
`95a4311224d8dfa5f481436e87da4b4d5f56a00d67278e7ed0e931476b584e26`,
`764975dd915913db4c4e0fc7bee308f8cb830c5f972ac0b97355601e7ff1b773`,
`180ad61eba6cbc82d7828c881494dff23a030bdda953d98b8ea42fc88e145874`,
`9b401032c2b0331174f74895181e906106bb86a32204b818b30686d9a47c0a42`,
and
`a6e98c1956c0a4a37a4b8a5ca46e56b0e9e66bf76928cd1669e43e4db1a68d02`.
It exercises generation-manifest and journal-v2 construction/replay,
lifetime-v1 and recovery-v1 prefixes, StateFS plans, owner contexts, requests,
receipts and faults, the syscall ABI/object, and manager transition, replay,
near-miss, one-shot, and fault boundaries. The fault inventory is exactly 144
operation/selector rows over 68 distinct numeric selector values; it does not
add a production selector surface.

The exact deterministic C17 build produces two byte-identical 33,048-byte
production objects with SHA-256
`73980718aa506c536387515073b93f228a433d5969c3610f8a0c945602d97043`
and one 41,376-byte fault object with SHA-256
`9b0429c7e1f8dc23117d74972de77a3defa923034f76d09b64a48b7604fc240e`.
The independent fault inspection digest is
`1c0d84f4f934da6c91d7c6b2af529fadc2f6d3afc1ed4853b485aeeda54ba414`;
the build-requirements and ABI-layout digests remain
`fb198db797d462d97b35272820daa0ed84547621a877671882432afced000c70`
and
`651ae0afeedca00a87275030238afe7788cb8852acb2f060f44f711712b041a0`.
The production objects expose only
`oxigraph_containment_statefs_execute_v1`, contain exactly thirteen reachable
direct syscall instructions, and contain no undefined symbol, PLT entry, or
test-only selector. The separate fault object retains the selector only for the
finite evaluator matrix.

After the count-checked ADR re-pin, the complete explicit non-G1.7 matrix must
pass 335/335 on both Node 24.14.1 and exact Node 20.20.2. Its mutation oracles
kill incomplete `statx_mask`, partial-publication, cleanup-liveness,
fixed-register, syscall-immediate, transition, binding, replay, and one-shot
defects while preserving every older byte-exact inverse. The engineering
package and lock remain at SHA-256
`6cbf5ba32081cc3ff540d3500fb34f5e63c15dde1edadc909500fc9fbf4c45a8`
and
`5076addd19b823b7669d20321dac066ddb269587b688675ac4c02d5c2b38612d`.
No candidate is added to a runtime, task-profile, or CLI registry.

This is local integrated implementation evidence, not a physical-host-positive
run or semantic qualification. It does not change the authority, physical-fact,
nonclaim, or readiness values above. S7 closes only after the exact frozen diff
receives independent filesystem, contract, compatibility, and security review
and task `task-1788573342748-wln111` is closed. Until then, and afterward unless
a later ADR explicitly supplies the missing authority, this ADR remains
Proposed, unregistered, and unavailable for production use.

## Acceptance boundary

The 2026-09-04 R13A correction is accepted only as a one-file amendment to
this ADR, with Proposed/not-implemented status and every authority,
physical-fact, readiness, nonclaim, ownership, and publication boundary
unchanged. Its evaluator-first successors must freeze all of the following
before corrected candidate or native implementation work resumes:

- unchanged 384-byte/alignment-8 observation layout with offset 76 renamed
  exactly to `statx_mask` and JavaScript field `statxMask`;
- negative cases that independently clear `STATX_BASIC_STATS` and
  `STATX_MNT_ID` from otherwise plausible non-`ABSENT` observations, a positive
  case with all `0x17ff` bits plus an extra bit, and exact zero-mask `ABSENT`;
- exact zero-, target-only-, and prior-canonical-slot retention for every
  mask/raw failure boundary, with no count or bytes from a partial slot;
- raw-name cases containing `0x01`, `0x1f`, and `0x7f` that cross the ABI and
  become semantic-unsafe inventory, plus `0x80` and `0xff`, overlength, and
  malformed records that terminate without publishing a partial entry; and
- cleanup-close success/failure pairs before step 5 completion, after an
  internal descriptor has actually been acquired, plus impossible-live
  controls that reject an overbroad `EFFECT_UNCERTAIN` classification.

The correction itself performs no source/evaluator/native edit, compile,
filesystem execution, task mutation, qualification, promotion, publication, or
push. Prior pins are not refreshed in place: each affected successor must use a
count-checked inverse that reconstructs its exact pre-R13 bytes before adopting
the corrected identity.

S0 is accepted only when the sole changed path is this ADR; all ten owned
candidate/evaluator paths remain absent; every export, schema, field order,
enum, numeric bound, grammar, ABI offset, syscall/flag, step sequence, errno and
effect rule, error precedence, actor/writer transition, crash prefix, evidence
profile, authority value, physical-fact value, and nonclaim above is literal and
contains no deferred implementation choice. S0 also requires:

- zero Markdown-format, relative-link, anchor, duplicate-ADR, dangling-edge,
  status, dependency-cycle, or source-only evidence errors;
- zero package, lock, registry, readiness, protected runtime, source, evaluator,
  fixture, Gist, or remote changes by this repository slice; it neither reads
  nor mutates out-of-band task-orchestration state;
- independent contract/ownership and ambiguity/security review bound to the
  exact one-file diff; and
- no MetaHarness qualification, provider execution, native compilation, live
  containment, `g1.7:*`, promotion, publication, or push.

Passing S0 makes only S1 and S3 dependency-eligible. S1 freezes the
source-absent statefs evaluator RED; S3 independently freezes the source-absent
C ABI/fault evaluator RED. Neither evaluator may be changed by a later GREEN
slice.

The full ADR-0037 S7 integrated boundary requires:

- exact held-root identity, owner/mode/link/type, no-follow, same-filesystem,
  six-directory, generation-uniqueness, and bounded-residue controls before any
  writer action;
- duplicate-manager nonblocking lock-contention controls with no fallback lock
  pathname; v1 has no post-acquisition lock-loss detector and keeps lock
  continuity an explicit nonclaim for ADR-0038/ADR-0039 lifecycle evidence;
- evaluator-owned operation plans and independently observed syscall receipts;
- an exact separately attested header, C source, compiler/recipe, repeated
  byte-identical link-time object, fixed entrypoint, eight-operation request
  enum, bounded last-step/failed-step/`errno`/observation result, exact
  `statx_mask` availability evidence, and operation-specific complete-prefix
  publication;
- rejection of root paths, callbacks, unknown operations, unbounded names or
  bytes, descriptor substitution, extra exports, process or cgroup behavior,
  and any production object retaining the test-only fault selector;
- injected failure immediately before and after create, write, file sync,
  no-replace install, directory sync, directory creation, move, source sync,
  destination sync, and cleanup boundaries;
- exact recovery for every epoch, lifetime-cgroup, manager-launch,
  guardian-launch, adoption, termination, removal, close, target, anchor,
  attempt, result, and generation-move prefix without actor reuse;
- exact anchored-empty, temporary-residue, collision, unsafe inventory,
  state-18 close, attempt-limit, and one-through-four reboot controls;
- hostile path, symlink, hard-link, device, FIFO, sparse directory, rename race,
  missing required `statx` mask bits, acceptance and retention of additional
  mask bits, raw control/DEL/high-bit names, partial observation publication,
  pre-step-5 cleanup-close liveness, mutable-buffer, Proxy, accessor, and
  over-count/over-byte rejection;
- unchanged ADR-0035 bytes, requirements digests, brands, authority and
  nonclaims, plus unchanged registries and production readiness; and
- focused and complete explicit non-G1.7 suites on current Node and Node 20,
  followed by independent filesystem, contract, compatibility, and security
  review.

Passing, reviewing, and integrating replacement S7 task
`task-1788573342748-wln111` does not make obsolete ADR-0038 S0 task
`task-1788424083626-k0qd39` eligible. After S7 integration that obsolete row
must be cancelled, and a new exact-base ADR-0038 S0 row must be created with
explicit dependencies on `task-1788573342748-wln111` and current completed
ADR-0035 native-preflight task `task-1788002473147-nsat6x`. Only that
replacement row can become eligible. This does not start ADR-0038 and is not
delegated-host qualification, production readiness, G1.7 authority, promotion,
or publication.

## Consequences

- Filesystem durability ordering becomes independently fault-testable.
- Manager recovery cannot silently acquire guardian process authority.
- Native code can consume one finite manager/statefs protocol instead of
  embedding recovery policy.
- Real crash, reboot, power-cut, and delegation evidence remains a later gate.
