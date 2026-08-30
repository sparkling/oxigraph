# ADR-0035: Durable native containment guardian and crash recovery

- **Status**: Proposed
- **Date**: 2026-08-29
- Updated: 2026-08-30
- Deciders: Oxigraph parity programme
- Implementation status: partially implemented and still unregistered. Commit
  `ab668ddd` adds local-only, authority-null journal construction and replay for
  the exact cancel-only transition graph. Commit `c2abb0df` adds the exact
  authority-null generation-manifest and journal-bundle v2 constructor,
  verifier, and replay around unchanged journal-v1 bytes. Commit `040f3343`
  adds the separate local Linux x86-64 execution-copy fixture for the attested
  executable preflight. Commit `2f901134` adds the exact authority-null
  lifetime-v1 identity, record, replay, finite reducer, reservation, selector,
  and same-origin brand boundary ratified here, together with frozen,
  semantic-adversarial, and hostile-input evaluators. Commits `2f2d1641`,
  `5a3d63e8`, and `3c4294cc` complete the recovery-v1 authority-null constructor,
  replay, planner, attempt boundary, containment recovery, failure-atomicity
  repair, and dual-runtime evaluator closure. None of these slices writes or
  recovers a filesystem journal, runs the stable native guardian, mutates a
  delegated cgroup, proves pidfd/waitid reap, or binds the executable through
  the ADR's race-free launch event; they remain absent from runtime,
  task-profile, and CLI registries. The next permitted slice is ADR-0036's
  evaluator-owned guardian-control RED suite and authority-null pure module.
  That contract must close before any filesystem-backed manager/guardian owner
  begins; no existing slice may activate production containment, G1.7, G2.2,
  qualification, promotion, or publication
- Programme task: `task-1788002473147-nsat6x` (84% at lifetime-v1 checkpoint)
- Contract-first successor task: `task-1788008900651-u20s3l` (completed;
  journal-v2, lifetime-v1, and recovery-v1 authority-null contracts verified)
- **Depends on**:
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0034 — First-class exact new-file admission](0034-first-class-exact-new-file-admission.md)
- **Related**:
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md),
  [ADR-0036 — Guardian-control pure ABI](0036-guardian-control-pure-abi.md),
  [ADR-0037 — Durable containment statefs and manager protocol](0037-durable-containment-statefs-and-manager-protocol.md),
  [ADR-0038 — Native containment manager, guardian, and launch trampoline](0038-native-containment-manager-guardian-and-trampoline.md),
  [ADR-0039 — Delegated-host containment qualification and readiness](0039-delegated-host-containment-qualification-and-readiness.md)

## Context

ADR-0034 defines the exact task-contract v2 admission model and freezes its
implemented primitives, but its complete unregistered gate and candidate
containment path remain open and unavailable. The current containment owner is
a simulated lifecycle contract, the predecessor native supervisor remains a
dormant compile-only artifact, and bootstrap v3 is a pure replay. Commit
`040f3343` separately proves only that an exact successor execution copy ran in
a local cancel-only fixture and that its live descriptors had the required
structural shape. Neither that fixture nor the predecessor proves semantic
retained-file content, live cgroup state, the ADR's race-free exec event,
pidfd/waitid reap authority, a durable guardian decision, or recovery after
controller failure.

The missing process boundary has two different lifetimes. A controller accepts
work and may restart. A guardian is the supervisor's direct parent and must
remain alive until it has observed status closure, reaped that child, reconciled
the complete cgroup subtree, and durably closed the generation. Treating those
roles as one restartable process would lose `waitid(P_PIDFD)` authority after a
crash: reopening a pidfd does not make the replacement process the child's
parent. Persisted numeric PIDs are not identities and must never become recovery
signalling targets.

The journal also governs irreversible effects. Recording that an action
occurred after attempting it cannot distinguish a crash before the action from
one after an ambiguous completion. Every external effect therefore needs a
durable intent first, and a future commit decision needs a durable exact
decision before any `COMMIT` byte is written.

## Decision

Introduce a dedicated native guardian/reaper and a write-once recovery journal
as an additive, versioned boundary. Keep the existing dormant supervisor,
bootstrap-v3 bytes, schema-v1 contracts, registries, and fixed production
readiness unchanged until the complete physical gate is independently
qualified.

### Decomposition and normative ownership

This ADR remains the umbrella and sole owner of the frozen journal-v1,
journal-v2, lifetime-v1, recovery-v1, cancel-only, lineage, recovery, Linux, and
physical acceptance literals below. It also owns the guardian/supervisor
process topology, inherited-descriptor provenance, and target supervisor
descriptor map. It does not own the serialized guardian-control vocabulary,
frame schemas, startup or `recvmsg` reports, byte ceilings, reducer transitions,
validation failure codes, or transcript-terminal rule; ADR-0036 owns and
freezes those literals. Four additive decisions refine the remaining
implementation without superseding or weakening the umbrella constraints:

| Decision                                                                                                                             | Exclusive implementation ownership                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ADR-0036 — Guardian-control pure ABI](0036-guardian-control-pure-abi.md)                                                            | Authority-null normal/recovery descriptor and frame contract before any physical owner                                                                                             |
| [ADR-0037 — Durable containment statefs and manager protocol](0037-durable-containment-statefs-and-manager-protocol.md)              | Sole statefs policy/oracle, exact held-root mechanics and manager handoff, plus the separately attested bounded statefs-syscalls object                                            |
| [ADR-0038 — Native containment manager, guardian, and launch trampoline](0038-native-containment-manager-guardian-and-trampoline.md) | Link and attest ADR-0037's object unchanged; own only exact manager/guardian/trampoline executables, race-free launch, process/cgroup/exec mechanics, and the unregistered adapter |
| [ADR-0039 — Delegated-host containment qualification and readiness](0039-delegated-host-containment-qualification-and-readiness.md)  | Consume ADR-0034's frozen pre-registration bytes; own isolated-host qualification, activation binding, and path-executed runtime closure only                                      |

The implementation order is recovery-v1 under this ADR, then ADR-0036,
ADR-0037, ADR-0038, and ADR-0039. Their Proposed status records work ownership,
not evidence. This decomposition does not change this ADR's Proposed status,
the current registries, any authority field, or production readiness
`{status: "unavailable", reason: "native-adapter-unavailable"}`.

### Stable guardian and delegated topology

The service manager supplies two already-open, trusted descriptors: an
owner-only state directory on a classified persistent filesystem and a
dedicated delegated cgroup-v2 parent. Candidate-controlled paths never select
either root. The delegated parent is process-empty and has the required
controllers enabled before admission.

The external service manager is the manager process's finite trust root. It
opens the exact statically attested manager executable, launches only that held
file with `execveat(AT_EMPTY_PATH)`, and holds the child at a positive,
race-free exec event before its first post-exec user-space instruction. While
the child remains stopped, the service manager binds the held file and the live
`/proc/<pid>/exe` device, inode, and independently read bytes into one launch
receipt. It releases the manager only after exact equality succeeds; no state
root, delegated-root, cgroup, or journal effect is permitted before release.
This externally evidenced launch primitive is the declared root of execution
trust and is not recursively delegated to the manager being proved.

The trusted service-manager owner first takes an exclusive nonblocking `flock`
on the held state-root directory descriptor. The classified state filesystem
must provide the native local open-file-description lock semantics used here;
remote NFS/SMB lock variants are outside the first gate. While holding that
lock, the manager obtains the guardian-lifetime epoch from `getrandom` with no
fallback as exactly 32 raw bytes, computes its lowercase SHA-256 digest,
durably consumes both in the lifetime ledger, creates
`guardian-<birthGuardianEpochSha256>`, and starts the guardian directly in that
cgroup with `clone3(CLONE_INTO_CGROUP | CLONE_PIDFD)`. It passes the same locked
open file description and the raw epoch through bounded inherited descriptors;
argv, environment variables, and candidate-controlled paths cannot supply or
replace either. Duplicate managers cannot pass the lock. This removes a
circular dependency in which the manager would otherwise need an epoch that a
running guardian had not generated yet.

The manager opens the exact attested guardian executable before its durable
launch intent and uses an attested, syscall-bounded launch trampoline to map the
fixed descriptors and call `execveat(AT_EMPTY_PATH)`. The child is traced from
`clone3` through a positive `PTRACE_EVENT_EXEC` (or a separately qualified
equivalent kernel-held exec stop); before that event the trace admits only the
exact descriptor remaps and `execveat`, and no filesystem, cgroup, signalling,
forking, or other mutation syscall. At the exec stop the manager binds the held
file to live `/proc/<pid>/exe` device, inode, and independently read bytes, then
durably records the exec receipt before releasing the guardian. Any missing
stop, syscall deviation, identity drift, read failure, or release-before-record
terminates the launch and enters recovery. Thus neither a pathname substitution
nor unobserved pre-exec child code can own a governed effect.

After release, the guardian does not admit work until it has adopted and
reverified the inherited lock and root, recomputed the exact epoch digest and
cgroup name, held delegated-root and lifetime-cgroup identities, verified its
own exact cgroup membership, and closed the initialization descriptor.

Guardian exec admits exactly FDs 0 through 7 and no others: FD 0 is the sole
connected `AF_UNIX/SOCK_SEQPACKET` controller channel and only that channel may
deliver bounded admission descriptors with `SCM_RIGHTS`; FD 1 is the guardian
status pipe; FD 2 is its bounded diagnostic pipe; FD 3 is the locked read-only
state-root directory; FD 4 is the read-only delegated-root directory; FD 5 is
the read-only guardian-lifetime cgroup directory; FD 6 is the read-only epoch
initialization pipe; and FD 7 is the read-only exact supervisor executable.
The manager is FD 6's sole writer and sends exactly the 32 raw epoch bytes then
EOF. Short input, a 33rd byte, missing EOF, a non-pipe, aliasing, wrong access
mode, or any extra descriptor fails initialization before readiness or
admission. The guardian recomputes the digest, binds all held-directory
identities and live membership, closes FD 6, and never accepts roots or an
executable by pathname. Controller-channel loss starts cancel/recovery and the
guardian lifetime then ends; a restarted controller receives a new lifetime
rather than attaching to the old socket.

The additive authority-null `containment-guardian-control-v1` contract freezes
the serialized contract for this descriptor map, exact bounded initialization
and admission frames, `SCM_RIGHTS` count and role validation, controller-loss
response, status frames, limits, and finite failure reasons before native
manager or guardian code is permitted. The guardian inherits the exact
supervisor executable on guardian FD 7 and uses that held descriptor only for
the race-free `execveat(AT_EMPTY_PATH)` transition. It is not supervisor FD 6.
The controller-transferred admission set contains all 14 launch-capsule-v3 file
roles, including the separate `supervisorSelf` retained byte-copy at supervisor
FD 6. As launch-capsule v3 already states, that retained copy does not bind the
executed supervisor image. The pure contract accepts neither root paths nor
injectable filesystem, cgroup, or process-mechanics callbacks.

The same contract has a separate recovery-only exec mode with exactly FDs 0
through 6: FD 0 is a read-only bounded canonical recovery-request pipe; FDs 1
through 4 retain their status, diagnostics, locked state-root, and
delegated-root roles; FD 5 is the read-only current recovery-actor lifetime
cgroup; and FD 6 carries exactly 32 raw bytes for a fresh recovery-actor epoch
then EOF. The recovery lifetime and its cgroup identity are allocated and
durably anchored before launch; they are never reconstructed from the dead
birth guardian or assumed to survive reboot. No controller socket, supervisor
executable, or admission descriptor is present, and FDs 7 and above are absent.
Recovery mode cannot admit work, launch a supervisor, emit application output,
or reuse the normal birth actor.

One stable guardian lifetime and its admissions use this topology:

```text
delegated-root/
  guardian-<birthGuardianEpochSha256>/
  ctl-<control-generation>/
  job-<job-generation>/
```

The service-manager owner removes the guardian-lifetime cgroup only after
guardian termination and exact empty-state observation. It never migrates a
running guardian from an intermediate cgroup. The stable guardian exclusively
creates, configures, kills, reconciles, and removes the per-admission `ctl` and
`job` cgroups. The supervisor receives only command input on FD 0, status output
on FD 1, bounded diagnostics on FD 2, the exact job-cgroup descriptor on FD 3, and the
already-declared retained files on FDs 4 through 17. A candidate never receives
FD 3 or writable cgroupfs visibility.

The guardian is the supervisor's stable direct parent. A controller may detach
or restart without transferring parentage. The guardian independently cancels
on controller loss and completes the bounded terminal sequence. If the guardian
itself dies, replacement recovery never reconstructs reap, exit-status, pipe,
or historical cleanup facts.

### Guardian-lifetime lineage

Manager launch and lifetime cleanup are external effects and follow the same
intent-first rule as admission and recovery; they are not undocumented service
orchestration. A separate additive lifetime-ledger v1 binds the manager actor,
held state/delegated/lifetime-root identities, consumed epoch, exact cgroup
name, limits, guardian executable identity, initialization descriptor contract,
and prior raw record. Its finite normal lineage distinguishes epoch consumption,
cgroup-create intent, configuration/readback, direct-launch intent, returned
guardian pidfd, post-launch membership, guardian initialization adoption,
termination, removal intent, pathname removal, and durable lifetime closure.
The admission guardian may append only its exact adoption observation and an
exact live-recovery attempt/head anchor before it begins that attempt;
birth-manager, guardian, and later recovery actors remain distinct. A
recovery-only guardian never appends a manager launch fact.

The pure `containment-guardian-lifetime-v1` contract freezes those record and
replay bytes first. Like journal bundle v2 and recovery ledger v1, it describes
required ordering and reported observations only; it grants no lock, launch,
wait, filesystem, cgroup, service-manager, or runtime authority.

The manager retains its copy of the shared locked open description until the
guardian has terminated and lifetime cleanup is closed. If the manager dies,
the guardian's inherited description keeps the lock held; if the guardian is
not alive, a replacement manager may acquire the lock and replay the lifetime
ledger. Crash prefixes after epoch consumption, cgroup creation/configuration,
direct launch, initialization adoption, guardian exit, and pathname removal
all have explicit recovery or quarantine dispositions. A consumed epoch is
never reused. Replacement management does not infer guardian reap, status, or
historical initialization from a cgroup name or persisted PID.

If the admission guardian dies or cannot finish its own recovery on the same
boot, the manager does not mutate `ctl` or `job` itself and does not create a
new lifetime. It durably consumes a fresh recovery-actor epoch in the existing
lifetime ledger, records recovery-launch intent with the exact incomplete
generation heads, and uses `clone3(CLONE_INTO_CGROUP | CLONE_PIDFD)` to launch
the attested guardian binary in recovery-only mode directly into the still-held
old lifetime cgroup. The recovery guardian adopts the same locked state-root
open description and old lifetime epoch but has a distinct recovery actor. Its exact launch,
membership, pidfd, exec, bounded recovery result, termination, and direct-child
wait are lifetime-ledger records. It alone reconciles the old generation-bound
`ctl` and `job` siblings. A failed recovery guardian leaves an honest prefix;
the manager may launch a bounded subsequent attempt with another fresh actor or
quarantine. Only after all old generations are terminal and all old cgroup
pathnames are absent may the manager remove the old lifetime cgroup, close its
ledger, and consume a new lifetime epoch.

A lifetime-ledger-proved reboot is the repeatable exception because the prior
boot's cgroupfs objects cannot survive it. After lifetime replay independently
establishes a new current boot and absence of the prior lifetime, control, and
job pathnames, the manager durably consumes a fresh reboot-recovery lifetime
epoch for that boot, creates/configures that current lifetime cgroup, and
launches only recovery-only guardians into it. FD 5 and every later attempt
anchor on that boot bind the current recovery lifetime, not a vanished prior
one. Reported
current delegated-root and recovery-lifetime identities must be non-null and
equal their current projections; difference from the target's historical root
is permitted only across this proved boot boundary. The actor reports both
target cgroup paths absent, all descriptor booleans false, never mutates those
historical names, and performs only the bounded filesystem recovery plan. A
second reboot during recovery repeats this proof and allocation; the four-
attempt ceiling bounds the number of represented transitions. Same-boot
recovery cannot use this exception.

Roles do not race over the delegated root. The manager alone creates,
configures, directly launches into, and later removes the lifetime cgroup; after
admission-guardian exec its only permitted delegated-root actions are direct
recovery-guardian launch into that same lifetime and the intent-bound lifetime
cleanup above, except for the proved reboot-recovery lifetime allocation above.
Admission and recovery guardians never mutate their lifetime
cgroup and alone own the bound `ctl` and `job` names. Outside the proved-reboot
exception, recovery finishes every exact old lifetime and admission
generation—including pathname absence—before a replacement manager may consume
a new epoch. Inventory admits exactly the current ledger-bound lifetime cgroup
plus its generation-bound `ctl` and `job` siblings; any other entry quarantines
the root.

### Durable identities

The service-manager owner and guardian obtain randomness through the kernel
with no weak fallback and bind these non-reusable values:

- a fresh manager-owned guardian-lifetime epoch for each new normal lifetime
  allocation, adopted as the normal chain's birth and actor epoch only after
  the admission guardian completes the locked initialization checks;
- a fresh admission generation and launch nonce;
- domain-separated control and job generations derived from the epoch and
  admission generation; and
- the current boot-ID digest.

The generation identity also binds the request and owner-request digests,
limits, delegated-root identity, exact cgroup names, launch-capsule raw and
projection digests, bootstrap and launch-requirement digests, and intended
supervisor executable identity. Birth and actor guardian epochs are distinct
semantic roles: every unchanged normal-v1 record requires actor equal to birth,
while every recovery-ledger actor is a fresh distinct value and cannot
impersonate the process that created a generation.

Full generation values are used in names. A guardian-lifetime epoch is never
consumed for another normal lifetime allocation, including after a failed
initialization or lock acquisition. A recovery-only process inherits the exact
still-open lifetime binding while using a fresh recovery actor; that is neither
a new normal lifetime nor reuse of the lifetime epoch as its actor or cgroup
name. Each proved-reboot exception uses the distinct recovery lifetime for its
new boot and never reuses a vanished historical epoch. Admission rejects a collision with a generation in any of `staging`,
`active`, `closed`, `recovered`, or `quarantined` and with any existing cgroup
entry. Serialized epoch equality remains an identity binding only; it never
proves freshness, process continuity, or actor origin.

### Schema layering and write-once journal

The existing `containment-guardian-journal-v1` record and replay schemas remain
byte-stable. They are the inner, normal cancel-only semantic chain: their
operation and evidence fields bind reported projection digests and deliberately
prove no physical operation, observation, origin, or durability.

The first additive persistence-format successor is journal-bundle v2. It is
intended for later physical persistence, but its current pure implementation is
authority-null. Each canonical, bounded bundle embeds one exact unchanged
journal-v1 record plus the exact canonical operation and evidence JSON-line
bytes whose semantic SHA-256 values equal that record's reported projection
digests. The bundle binds the raw SHA-256 and canonical semantic SHA-256 of all
three artifacts, the generation, sequence, prior v2 bundle raw SHA-256, and the
inner v1 record name and raw SHA-256. Standalone bundle verification rejects
noncanonical bytes, digest substitution, a v1/v2 sequence or generation
mismatch, or any inner-v1 record that does not independently verify. Full replay
additionally rejects multiple successors and gaps. The v2 envelope does not
reinterpret or modify v1, including the sequence-8 `DECISION_CANCEL_DURABLE`
record required by executable preflight v4.

Journal-bundle v2 admits at most 18 bundles with the unchanged 16-digit
sequence width and all-zero genesis raw SHA-256. An embedded v1 record and each
operation/evidence artifact admit at most 16 KiB of canonical JSONL bytes; the
complete canonical bundle admits at most 96 KiB. The bundle embeds those exact
bytes as strict padded canonical RFC 4648 base64. Every artifact descriptor
binds raw SHA-256 over the single-LF JSONL bytes and semantic SHA-256 over the
canonical JSON value without that LF; the inner descriptor additionally binds
the exact v1 filename. Bundle filenames remain
`<16-digit-sequence>-<bundle-raw-sha256>.jsonl`.

The bundle repeats and verifies the exact sequence, record type, prior/next
state, generation, birth/actor epoch, boot, admission, control, and job
identities from its embedded v1 record. Creation and replay call the unchanged
v1 verifier/replayer. The v1 predecessor and v2 predecessor must advance
together, and the operation/evidence semantic digests must equal the embedded
record's reported projection digests. Operation and evidence payloads remain
opaque bounded canonical JSON values in this slice: binding their exact bytes
does not reinterpret them as a physical effect or observation. State-specific
physical receipt schemas belong to the later native-owner contract.

The admission guardian owns creation of one immutable `generation.jsonl`
before the staging-to-active transition; recovery may verify but never replace
it. Its exact generation-manifest v2 schema is bounded to 16 KiB and contains
only the full unchanged-v1 generation identity, repeated generation/birth/boot/
admission/control/job digests and exact cgroup names, plus the unchanged v1
journal-requirements SHA-256. It contains no time, pathname, actor-liveness, or
physical-effect claim. The pure manifest constructor/verifier remains
authority-null; only the later physical guardian may persist its bytes.

#### Exact pure lifetime-ledger v1 contract

The first implementation prerequisite for ready recovery is the additive pure
`containment-guardian-lifetime-v1` contract. It is the sole owner of the in-
process brands for a recovery-target projection, recovery-attempt anchor
projection, recovery external head, and normal-close receipt projection.
Recovery-v1 imports only its read-only requirements-digest constant and five
brand assertion functions; it imports no lifetime selector or implementation
helper. Lifetime-v1 never imports recovery-v1. This one-way dependency prevents
a circular module or requirements-hash seam.

The exact lifetime schemas are:

```text
oxigraph.candidate-containment-guardian-lifetime-identity/v1
oxigraph.candidate-containment-guardian-lifetime-context/v1
oxigraph.candidate-containment-guardian-lifetime-record/v1
oxigraph.candidate-containment-guardian-lifetime-replay/v1
oxigraph.candidate-containment-guardian-lifetime-requirements/v1
oxigraph.candidate-containment-guardian-lifetime-target-reboot-transition-projection/v1
oxigraph.candidate-containment-guardian-lifetime-target-reboot-transition-chain-event/v1
oxigraph.candidate-containment-guardian-lifetime-partial-launch-resolution-projection/v1
oxigraph.candidate-containment-guardian-lifetime-no-child-launch-failure-projection/v1
oxigraph.candidate-containment-guardian-lifetime-target-genesis-inventory-projection/v1
oxigraph.candidate-containment-guardian-lifetime-recovery-target-projection/v1
oxigraph.candidate-containment-guardian-lifetime-target-genesis-event/v1
oxigraph.candidate-containment-guardian-lifetime-recovery-attempt-anchor-event/v1
oxigraph.candidate-containment-lifetime-recovery-attempt-anchor-projection/v1
oxigraph.candidate-containment-lifetime-normal-close-receipt-projection/v1
oxigraph.candidate-containment-recovery-external-head/v1
```

The lifetime identity has exactly these ordered fields:

```text
schema
lifetimeKind
stateRootIdentitySha256
managerActorEpochSha256
bootIdSha256
delegatedRootIdentitySha256
lifetimeEpochSha256
lifetimeCgroupName
limitsSha256
guardianExecutableIdentitySha256
guardianControlRequirementsSha256
previousLifetimeEpochSha256
previousLifetimeRecordSequence
previousLifetimeRecordRawSha256
identitySha256
```

`lifetimeKind` is exactly `NORMAL` or `REBOOT_RECOVERY`. Every digest is a
lowercase SHA-256. `lifetimeCgroupName` is derived exactly as
`guardian-<lifetimeEpochSha256>` and is never caller-selected. A normal genesis
identity has null previous epoch and sequence plus the all-zero raw head. A
reboot-recovery successor has an all-non-null predecessor tuple equal to a
complete-tail-matched, nonclosed previous lifetime replay, a fresh lifetime
epoch, and a different boot. Its predecessor replay must contain neither
`LIFETIME_REMOVAL_INTENT_DURABLE` nor `LIFETIME_PATH_ABSENT_OBSERVED`. Once
removal begins, pathname absence and durable closure must follow in that same
segment; a successor is forbidden both while either relationship is open and
after closure. Partial predecessor tuples are rejected. `identitySha256` is
the canonical semantic SHA-256 of every preceding identity field.
`managerActorEpochSha256` names the stable external service-manager owner that
roots and journals inner-manager replacements, not a restartable inner manager
PID or process-continuity claim. All `SERVICE_MANAGER` records bind that one
epoch across the complete lifetime chain.

The configured lifetime context has exactly these ordered fields:

```text
schema
lifetimeIdentitySha256
stateRootIdentitySha256
bootIdSha256
delegatedRootIdentitySha256
lifetimeCgroupIdentitySha256
contextSha256
```

Its first four identities equal the lifetime identity, its current lifetime-
cgroup identity is a non-null lowercase SHA-256 reported by the configured-
observation record, and its final digest covers every preceding field. It is a
reported structural binding only; the pure module does not observe a root,
boot, cgroup, or configuration.

A target reboot transition has exactly these ordered fields:

```text
schema
targetSha256
previousBootIdSha256
previousDelegatedRootIdentitySha256
previousSegmentConfigured
previousLifetimeCgroupIdentitySha256
previousLifetimeEpochSha256
previousLifetimeRecordRawSha256
currentBootIdSha256
currentDelegatedRootIdentitySha256
currentSegmentConfigured
currentLifetimeCgroupIdentitySha256
currentLifetimeEpochSha256
reportedPreviousLifetimeCgroupAbsent
reportedControlCgroupAbsent
reportedJobCgroupAbsent
transitionSha256
```

All three absence fields are true, the current boot differs from the previous
boot, and the current epoch differs from every prior epoch. The configured flags
are Booleans. A true flag requires the matching configured context and non-null
cgroup identity; a false flag requires that segment to have no configured-
observation record and makes its cgroup identity null. Boot, delegated-root,
epoch, previous-record, and optional configured-context fields equal the exact
adjacent lifetime segments. The first previous segment and the final current
segment in a target transition chain must be configured; an unconfigured
segment is representable only as an intermediate crash prefix. State-root
identity never changes. The transition digest covers every preceding field.
This value reports the physical observations; it does not prove them.

A target reboot-transition chain event has exactly `schema`, `targetSha256`,
`transitions`, and `eventSha256`. `transitions` is a dense array of one through
four exact transition projections in lifetime-segment order. The first previous
side equals the target's last replayed context and that segment's complete head;
each adjacent item joins the same boot, delegated-root, configured flag,
cgroup identity, lifetime epoch, and intervening segment head; and the final
current side equals the record segment's configured context. The array traverses
every lifetime segment since the target's prior context, including an unfinished
intermediate segment, without skipping or duplicating a boot. Its length plus
the target's prior transition count is at most four. The event digest covers
every preceding field. One record atomically advances the target across the
whole bounded chain in pure replay; it does not rewrite an older segment.

A replacement-only partial-launch resolution projection has exactly `schema`,
`lifetimeIdentitySha256`, `targetSha256`, `launchRecordRawSha256`,
`reportedStateRootLockReacquired`, `reportedPriorManagerAbsent`,
`reportedLifetimeCgroupIdentitySha256`, `reportedLifetimeCgroupEmpty`, and
`projectionSha256`. Target is null for the normal guardian or the exact target
for a recovery guardian; the three reported booleans are true, and the cgroup
identity equals the configured context. The final digest covers every preceding
field. This structural evidence is mandatory when a replacement service
manager resolves a partial launch and remains a physical nonclaim.

A same-manager definite no-child launch-failure projection has exactly
`schema`, `lifetimeIdentitySha256`, `targetSha256`,
`launchRecordRawSha256`, `syscall`, `resultClass`, `errnoName`,
`reportedChildCreated`, `reportedPidfdReturned`, and `projectionSha256`.
`syscall` is `clone3`; result class is `DEFINITE_NO_CHILD`; errno name is
exactly one of `[EACCES, EAGAIN, EBUSY, EINVAL, ENOMEM, ENOSYS,
EOPNOTSUPP, EPERM]`; both reported booleans are false. Target is null for the
normal launch and exact for a recovery launch. The final digest covers every
preceding field. Only the same still-current service-manager owner may bind this
result; an ambiguous crash never uses it.

A target-genesis inventory projection has exactly `schema`, `targetSha256`,
`reportedRecoveryDirectoryPresent`, `reportedRecoveryDirectoryEntryCount`,
`reportedExistingLifetimeTargetHead`, and `inventorySha256`. Its values are
respectively true, zero, and false before the final digest; any recovery entry
or existing head rejects genesis adoption. The projection is required for every
generation-head record and remains a completeness nonclaim.

A recovery-target projection has exactly these ordered fields:

```text
schema
generationIdentitySha256
generationManifestRawSha256
targetSha256
targetBootIdSha256
targetDelegatedRootIdentitySha256
targetLifetimeEpochSha256
latestBundleSequence
latestBundleRawSha256
latestInnerRecordRawSha256
latestNormalState
projectionSha256
```

The generation, manifest, target, target-boot, target-delegated-root, and
target-lifetime-epoch fields equal the immutable
recovery target derived from the independently verified generation manifest and
normal journal-v2 chain; the epoch equals its birth-guardian epoch. They also
equal the normal lifetime's configured context and identity, or the first
previous side of a reboot catch-up chain. The four latest-normal-head fields are either all null
or all non-null and equal that target. The final digest covers every preceding
field. The structural projection may be derived before its lifetime record is
written, but it becomes a recovery-accepted boundary only when selected as a
paired value from complete-tail-matched lifetime replay.

A target-genesis event has exactly `schema`, `recoveryTargetProjection`,
`targetGenesisInventory`, `provedRebootTransitions`, and `eventSha256`. The
first two values are the exact projections above for the record target.
`provedRebootTransitions` is a dense array: empty for a same-boot normal-segment
genesis, or one through four exact transition projections for a first target
introduced by the service manager in a configured `REBOOT_RECOVERY` segment.
The nonempty array obeys the same contiguous chain rule above from the target's
historical normal context through every intervening lifetime segment to the
current configured context. It starts the target's transition count at the
array length and closes the repeated-reboot crash window without appending to
an older segment. The final digest covers every preceding field. Neither form
proves the observations or persistence it reports.

Every lifetime record's canonical bytes contain exactly these ordered fields:

```text
schema
sequence
recordType
previousRecordRawSha256
lifetimeIdentity
writerKind
writerActorEpochSha256
targetSha256
operation
evidence
```

`sequence` is 16 decimal digits. `writerKind` is exactly `SERVICE_MANAGER`,
`LIVE_BIRTH_GUARDIAN`, or `RECOVERY_ONLY_GUARDIAN`; the writer epoch is a
lowercase SHA-256 and must satisfy the exact state-specific writer table below.
`targetSha256` is null only for lifetime-wide records and otherwise
identifies one immutable recovery target. `previousRecordRawSha256` is all zero
only at sequence 1 and otherwise equals the exact prior record in the same
segment. A record's final filename is
`<16-digit-sequence>-<record-raw-sha256>.jsonl`.

Create and standalone verify return a canonical single-LF JSONL copy-on-read
wrapper with exactly these ordered public properties: `bytes`, `name`,
`rawSha256`, `semanticSha256`, `schema`, `sequence`, `recordType`,
`previousRecordRawSha256`, `lifetimeIdentity`, `writerKind`,
`writerActorEpochSha256`, `targetSha256`, `operation`, `evidence`,
`standaloneRecordHashChainValidated: false`, `recordGrammarValidated: false`,
and `embeddedArtifactBindingsValidated: true`. Canonical bytes contain only the
ten record fields above. Standalone verification never upgrades chain or
grammar validation; only replay of the complete exact segment prefix validates
those relationships.

The ordered lifetime record vocabulary is exactly:

```text
NORMAL_LIFETIME_EPOCH_CONSUMED
REBOOT_RECOVERY_LIFETIME_EPOCH_CONSUMED
LIFETIME_CGROUP_CREATE_INTENT_DURABLE
LIFETIME_CGROUP_CONFIGURED_OBSERVED
GUARDIAN_LAUNCH_INTENT_DURABLE
GUARDIAN_NOT_CREATED_OBSERVED
GUARDIAN_PIDFD_OBSERVED
GUARDIAN_EXEC_OBSERVED
GUARDIAN_MEMBERSHIP_OBSERVED
GUARDIAN_INITIALIZATION_ADOPTED
GENERATION_RECOVERY_HEAD_DURABLE
TARGET_REBOOT_TRANSITION_OBSERVED
RECOVERY_ATTEMPT_ANCHOR_DURABLE
RECOVERY_GUARDIAN_LAUNCH_INTENT_DURABLE
RECOVERY_GUARDIAN_NOT_CREATED_OBSERVED
RECOVERY_GUARDIAN_PIDFD_OBSERVED
RECOVERY_GUARDIAN_EXEC_OBSERVED
RECOVERY_GUARDIAN_MEMBERSHIP_OBSERVED
RECOVERY_ATTEMPT_RESULT_DURABLE
RECOVERY_GUARDIAN_TERMINATION_OBSERVED
RECOVERY_GUARDIAN_REAPED_OBSERVED
RECOVERY_GUARDIAN_PARENTAGE_LOST_OBSERVED
NORMAL_CLOSE_RECEIPT_DURABLE
GUARDIAN_TERMINATION_OBSERVED
GUARDIAN_REAPED_OBSERVED
GUARDIAN_PARENTAGE_LOST_OBSERVED
LIFETIME_REMOVAL_INTENT_DURABLE
LIFETIME_PATH_ABSENT_OBSERVED
LIFETIME_CLOSED_DURABLE
```

The record relationship table is exact. “Previous” means the latest applicable
segment-wide or per-target event derived from the complete branded predecessor
replay; unrelated target events may be interleaved but cannot change that
relationship.

| Record type                                 | Exact writer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Target                   | Exact predecessor/replay relationship                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NORMAL_LIFETIME_EPOCH_CONSUMED`            | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | null                     | sequence 1 of the sole `NORMAL` genesis segment; zero prior replay and all-zero record head                                                                                                                                                                                                                                                                                                                                                                                                             |
| `REBOOT_RECOVERY_LIFETIME_EPOCH_CONSUMED`   | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | null                     | sequence 1 of a `REBOOT_RECOVERY` segment; previous complete-tail-matched nonclosed segment tuple equals the identity predecessor; that predecessor replay contains neither removal intent nor pathname absence; boot and lifetime epoch both differ                                                                                                                                                                                                                                                    |
| `LIFETIME_CGROUP_CREATE_INTENT_DURABLE`     | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | null                     | segment epoch-consumed is the previous segment-wide event                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `LIFETIME_CGROUP_CONFIGURED_OBSERVED`       | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | null                     | cgroup-create intent; evidence is the exact configured context                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GUARDIAN_LAUNCH_INTENT_DURABLE`            | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | null                     | configured `NORMAL` context; no normal guardian launch event exists                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `GUARDIAN_NOT_CREATED_OBSERVED`             | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | null                     | normal guardian launch intent; exact same-manager definite-no-child launch-failure evidence; no pidfd/child/termination event exists                                                                                                                                                                                                                                                                                                                                                                    |
| `GUARDIAN_PIDFD_OBSERVED`                   | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | null                     | normal guardian launch intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `GUARDIAN_EXEC_OBSERVED`                    | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | null                     | normal guardian pidfd observation                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GUARDIAN_MEMBERSHIP_OBSERVED`              | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | null                     | normal guardian exec observation                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `GUARDIAN_INITIALIZATION_ADOPTED`           | live-birth guardian; epoch = normal lifetime epoch                                                                                                                                                                                                                                                                                                                                                                                                                                                     | null                     | normal guardian membership observation                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `GENERATION_RECOVERY_HEAD_DURABLE`          | live-birth guardian with normal lifetime epoch after its exact initialization-adopted prefix, or service manager with manager epoch after normal-guardian terminal resolution or in a configured proved-reboot segment                                                                                                                                                                                                                                                                                 | non-null                 | target and generation identity absent from replay; target count below six and complete append reserve available; operation is the exact target-genesis event, whose reboot-transition chain is empty except for service-manager genesis after one or more proved-reboot segments; evidence is its sole genesis `NO_RECOVERY_ATTEMPT` head                                                                                                                                                               |
| `TARGET_REBOOT_TRANSITION_OBSERVED`         | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | non-null existing target | current reboot segment is configured; operation is the exact one-through-four transition-chain event covering every segment since the target's latest context; target has no transition ending at this segment; latest external head remains unchanged                                                                                                                                                                                                                                                  |
| `RECOVERY_ATTEMPT_ANCHOR_DURABLE`           | initialized live-birth guardian with epoch = anchor actor and no not-created/termination/reboot supersession, or service manager with epoch = manager actor for a recovery-only anchor                                                                                                                                                                                                                                                                                                                 | non-null existing target | configured context; complete reboot-transition catch-up exists iff boot changed; no unresolved anchor; target nonterminal; attempt count below four; complete append reserve exists for the whole attempt/result/actor-resolution suffix; evidence is the exact anchor event                                                                                                                                                                                                                            |
| `RECOVERY_GUARDIAN_LAUNCH_INTENT_DURABLE`   | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | anchor target            | current anchor is recovery-only and has no launch event                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `RECOVERY_GUARDIAN_NOT_CREATED_OBSERVED`    | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | anchor target            | recovery launch intent; exact same-manager definite-no-child launch-failure evidence; no pidfd/child/termination event exists                                                                                                                                                                                                                                                                                                                                                                           |
| `RECOVERY_GUARDIAN_PIDFD_OBSERVED`          | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | anchor target            | recovery launch intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `RECOVERY_GUARDIAN_EXEC_OBSERVED`           | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | anchor target            | recovery guardian pidfd observation                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `RECOVERY_GUARDIAN_MEMBERSHIP_OBSERVED`     | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | anchor target            | recovery guardian exec observation                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `RECOVERY_ATTEMPT_RESULT_DURABLE`           | matching initialized live-birth actor before termination/reboot; matching recovery-only actor only after its exact launch-intent/pidfd/exec/membership prefix and before not-created/termination/reboot; service manager for a recovery-only anchor after exact never-launched pre-temp `ABSENT`/`PRESENT_EMPTY` observation or recovery-guardian not-created; or service manager for either actor kind only after that actor's same-boot terminal resolution or configured target reboot supersession | anchor target            | exact current anchor; result binds that anchor and recovery head; residue-free never-launched/not-created result is anchored-empty; launched result is structurally observed from the exact recovery ledger; temp/other residue rejects; a live-birth empty directory never grants the manager a direct pre-resolution result branch; after reboot, complete target catch-up and exact directory/ledger observation replace unobtainable old-boot process evidence without claiming reap or exit status |
| `RECOVERY_GUARDIAN_TERMINATION_OBSERVED`    | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | anchor target            | any durable recovery launch-intent prefix; may follow its honest launch prefix or result; replacement-manager use additionally requires reported lock reacquisition plus exact lifetime-cgroup empty/identity evidence; occurs once                                                                                                                                                                                                                                                                     |
| `RECOVERY_GUARDIAN_REAPED_OBSERVED`         | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | anchor target            | termination observed and this manager retains exclusive direct-child wait authority                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `RECOVERY_GUARDIAN_PARENTAGE_LOST_OBSERVED` | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | anchor target            | termination observed after manager replacement; direct-child wait authority is absent and no reap/exit-status claim is made                                                                                                                                                                                                                                                                                                                                                                             |
| `NORMAL_CLOSE_RECEIPT_DURABLE`              | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | non-null existing target | target has its unique genesis head, zero attempts, no recovery terminal, and zero through four exact replay-derived transitions ending in the current configured context; evidence is the exact close-receipt projection replay will brand                                                                                                                                                                                                                                                              |
| `GUARDIAN_TERMINATION_OBSERVED`             | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | null                     | any durable normal launch-intent prefix has terminated, independently of target terminality; replacement-manager use additionally requires reported lock reacquisition plus exact lifetime-cgroup empty/identity evidence                                                                                                                                                                                                                                                                               |
| `GUARDIAN_REAPED_OBSERVED`                  | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | null                     | normal guardian termination observed and this manager retains exclusive direct-child wait authority                                                                                                                                                                                                                                                                                                                                                                                                     |
| `GUARDIAN_PARENTAGE_LOST_OBSERVED`          | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | null                     | normal guardian termination observed after manager replacement; no reap/exit-status claim                                                                                                                                                                                                                                                                                                                                                                                                               |
| `LIFETIME_REMOVAL_INTENT_DURABLE`           | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | null                     | every target is terminal; no anchor/result relationship is open; the current-segment normal guardian is not-created, reaped, parentage-lost, or absent because reboot superseded the prior actor; and every current-segment recovery launch is not-created or termination followed by reap or parentage-lost                                                                                                                                                                                            |
| `LIFETIME_PATH_ABSENT_OBSERVED`             | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | null                     | lifetime removal intent                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `LIFETIME_CLOSED_DURABLE`                   | service manager; epoch = manager actor                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | null                     | lifetime pathname absence observation; no successor in this segment                                                                                                                                                                                                                                                                                                                                                                                                                                     |

`SERVICE_MANAGER` always binds `managerActorEpochSha256`. The live-birth writer
for normal initialization or its own target head binds the normal lifetime epoch. A live-birth or
recovery-only writer on a result binds the current anchor actor. Every other
writer/epoch combination rejects. Target nullability is exactly the table. A
recovery-only launch lifecycle is forbidden for a live-birth anchor; that actor
is already running. A live-birth target head, anchor, or actor-written result
requires the matching `GUARDIAN_INITIALIZATION_ADOPTED` prefix and rejects after
not-created, termination, or reboot supersession. A recovery-only actor-written
result requires the matching anchor followed by launch intent, pidfd, exec, and
membership observations and rejects after not-created, termination, or reboot
supersession. Structural writer eligibility does not prove physical liveness or
execution, but a serialized actor result cannot appear from an unlaunched
lineage. A successor anchor requires one exact result; if a recovery
launch intent exists it additionally requires exact not-created, same-boot
reap-or-parentage-lost terminal resolution, or the target's exact configured
reboot supersession. An abandoned prelaunch anchor needs only
its exact never-launched anchored-empty result.
No parentage-lost record may coexist with a reap record for the same actor.
After normal-guardian termination resolution or exact reboot supersession,
every later target writer is service manager or recovery-only; a live-birth
writer is permanently forbidden.
A recovery-only anchor after normal-guardian adoption or any live-birth anchor
requires either normal-guardian termination resolution on the same boot or that
target's exact complete configured proved-reboot catch-up first. Same-process
successive live-birth anchors may proceed after their exact prior result without
a fabricated recovery-guardian launch lifecycle.

A normal segment starts with `NORMAL_LIFETIME_EPOCH_CONSUMED`; every successor
segment starts with `REBOOT_RECOVERY_LIFETIME_EPOCH_CONSUMED`. Cgroup-create
intent precedes its configured-context observation. The normal guardian launch
orders launch intent followed by exactly definite not-created or pidfd, exec,
membership, then initialization adoption.
A later reboot successor may follow a crash-interrupted segment whose cgroup
intent or configured observation was never completed; no writer appends to that
old segment after opening the successor. It may not follow a segment containing
removal intent or pathname absence: once removal begins, the same segment must
record pathname absence and durable closure, and an intervening reboot leaves
the plan blocked rather than stranding an accepted successor prefix. Once the
latest segment reaches its configured context, each target's next transition-
chain event traverses every intervening segment identity and optional
configured context atomically. A further crash merely lengthens that target's
still-bounded catch-up chain. Five segments and four transition projections are
the shared hard ceiling, so a fifth reboot rejects instead of truncating
ancestry.
A recovery attempt anchor precedes any recovery guardian launch event. A
successor anchor requires one result-head record and, iff a recovery launch
intent exists, not-created, same-boot terminal resolution, or target reboot
supersession for its predecessor actor. A launched actor may durably publish its structurally
matched result before termination. If it never launched, an exact anchored-
empty result may follow the anchor directly after restored filesystem
observation. If it launched but produced no result, a replacement may derive an
anchored-empty or finalized head only from exact recovery-ledger observation
after same-boot terminal resolution or target reboot supersession. Same-boot
terminal resolution is exactly termination followed
by either direct-child reap when the current manager still owns wait authority,
or the distinct parentage-lost observation after manager death. The latter
claims no reap or exit status. Termination after a partial normal or recovery
launch prefix is permitted only after the later native owner reports exact lock
reacquisition plus lifetime-cgroup empty/identity evidence; pure payload binding
does not prove those facts. No event may be invented to fill an honest crash
prefix. A complete configured proved-reboot catch-up is a distinct structural
supersession boundary: the chain's exact reports that every crossed previous
lifetime, control, and job cgroup is absent permit recovery-only progress without same-lifetime
empty/identity evidence. It never fabricates termination, reap, parentage, or
exit status for an old-boot actor, and old-boot process-lifecycle records are
forbidden after the catch-up. Normal lifetime removal similarly requires
same-boot guardian termination then exactly reap or parentage-lost, or exact
reboot supersession when no current-segment normal guardian exists, followed by removal intent, pathname-absence
observation, and closure. A terminal target rejects a new attempt but still
admits only its required actor-resolution records, bounded reboot catch-up, and
lifetime-removal/closure records. A lifetime terminal rejects every successor.

A terminal recovery result does not resolve its actor. Before lifetime removal,
every recovery-only launch in the current segment must independently reach exact
not-created or termination followed by reap or parentage-lost, and every anchor
must have its one result. A result written by a still-live recovery guardian
therefore leaves replay at a valid open prefix and cannot make removal eligible.
For an old-segment recovery actor, only that target's configured reboot
supersession supplies the distinct no-process-claim resolution described above.

Operation and evidence descriptors have the same exact five fields as
recovery-v1: `schema`, `rawSha256`, `semanticSha256`, `bytesBase64`, and
`bindingSha256`. Their exact binding preimage has `schema`, `kind`,
`artifactSchema`, `sequence`, `recordType`, `lifetimeIdentitySha256`,
`writerKind`, `writerActorEpochSha256`, `targetSha256`, `rawSha256`, and
`semanticSha256`. The descriptor schema is exactly
`oxigraph.candidate-containment-guardian-lifetime-{operation|evidence}/<lower-kebab-record-type>/v1`.
The record-type component is formed only by ASCII-lowercasing and replacing
each underscore with one hyphen. The binding preimage's `schema` is exactly
`oxigraph.candidate-containment-guardian-lifetime-{operation|evidence}-binding/v1`,
`kind` is exactly `operation` or `evidence`, and `artifactSchema` is that exact
descriptor schema. Raw SHA-256 covers the payload's canonical single-LF JSONL
bytes; semantic SHA-256 covers its canonical JSON value without the LF; and the
binding SHA-256 covers the canonical binding projection without an LF. The
binding projection excludes `bytesBase64`, `bindingSha256`, and the complete
lifetime record, so it is neither circular nor size-ambiguous. Payloads are bounded opaque canonical JSON except for the
exact structural values below; a descriptor never proves an operation,
observation, origin, or physical effect.

Structural interpretation is limited to:

- the configured lifetime context at
  `LIFETIME_CGROUP_CONFIGURED_OBSERVED`;
- the exact target-genesis event, including its recovery-target projection,
  target-genesis inventory, and bounded proved-reboot transition array, at
  `GENERATION_RECOVERY_HEAD_DURABLE`;
- a genesis `NO_RECOVERY_ATTEMPT` external head at that same record;
- the exact target reboot-transition chain event at
  `TARGET_REBOOT_TRANSITION_OBSERVED`;
- the exact replacement partial-launch resolution at a partial-prefix
  guardian-termination record;
- the exact definite no-child projection at either not-created record;
- the exact anchor event at `RECOVERY_ATTEMPT_ANCHOR_DURABLE`;
- the exact successor external head at `RECOVERY_ATTEMPT_RESULT_DURABLE`; and
- the exact normal-close receipt at `NORMAL_CLOSE_RECEIPT_DURABLE`.

The anchor-event evidence has exactly `schema`, `predecessorExternalHead`,
`anchorProjection`, and `eventSha256`; the final digest covers every preceding
field. Its lifetime-record raw SHA-256 is the associated
`lifetimeAttemptAnchorRawSha256`. The anchor projection has exactly the fields
defined in the recovery section below and repeats the current configured
context. Its actor/directory is fresh, its predecessor equals the target's
latest external head, and a proved reboot permits only
`RECOVERY_ONLY_GUARDIAN`. A result-head record is required before another
anchor; a successor anchor alone never authenticates the missing result.

The external head and normal-close receipt have exactly the fields defined in
the recovery section. A target starts with one `NO_RECOVERY_ATTEMPT` head.
An anchored-empty result binds the current anchor and null sequence/all-zero
recovery head; a finalized result binds the same anchor and exact non-null
recovery record head. A terminal `RECOVERED` or `QUARANTINED` result rejects
another attempt. A normal-close receipt is allowed only with no recovery
attempt, the exact target, `active` to `closed`, both parent syncs true, and
closed reobservation true.

Across every segment, replay admits exactly one recovery target for a given
`generationIdentitySha256`. A second generation-head record for that identity
rejects even if it repeats the same `targetSha256`; a record that reuses a
target SHA-256 for a different generation identity also rejects. A same-boot
target genesis starts with zero transitions. A target genesis on a configured
proved-reboot segment starts from the event's current configured context with
`bootTransitionCount` equal to its one-through-four transition-array length;
that embedded chain covers every segment through the record segment and a
separate `TARGET_REBOOT_TRANSITION_OBSERVED` record ending there would be a
duplicate.

The pure lifetime module exports its exact frozen schemas, bounds, vocabularies,
authority/nonclaim/physical-fact values, requirements value, and canonical
SHA-256 under exactly these required public value identifiers:

```text
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_IDENTITY_SCHEMA_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_CONTEXT_SCHEMA_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECORD_SCHEMA_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REPLAY_SCHEMA_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SCHEMA_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_REBOOT_TRANSITION_SCHEMA_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_REBOOT_TRANSITION_CHAIN_EVENT_SCHEMA_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_PARTIAL_LAUNCH_RESOLUTION_SCHEMA_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NO_CHILD_LAUNCH_FAILURE_SCHEMA_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_GENESIS_INVENTORY_SCHEMA_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECOVERY_TARGET_PROJECTION_SCHEMA_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_GENESIS_EVENT_SCHEMA_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECOVERY_ATTEMPT_ANCHOR_EVENT_SCHEMA_V1
CANDIDATE_CONTAINMENT_LIFETIME_RECOVERY_ATTEMPT_ANCHOR_PROJECTION_SCHEMA_V1
CANDIDATE_CONTAINMENT_LIFETIME_NORMAL_CLOSE_RECEIPT_PROJECTION_SCHEMA_V1
CANDIDATE_CONTAINMENT_RECOVERY_EXTERNAL_HEAD_SCHEMA_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_SEQUENCE_WIDTH_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEGMENTS_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECORDS_PER_SEGMENT_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECORDS_ACROSS_SEGMENTS_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_CONTROL_VALUE_BYTES_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_OPERATION_OR_EVIDENCE_BYTES_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECORD_BYTES_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_AGGREGATE_RECORD_BYTES_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECOVERY_ATTEMPTS_PER_TARGET_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_BOOT_TRANSITIONS_PER_TARGET_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_TARGETS_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_GLOBAL_RECORDS_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_RECORDS_PER_TARGET_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_RECORDS_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MIN_CLOSURE_RESERVE_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_GENESIS_RAW_SHA256_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_KINDS_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_WRITER_KINDS_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECORD_TYPES_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REPLAY_STATUSES_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NO_CHILD_ERRNO_NAMES_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_AUTHORITY_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NONCLAIMS_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_PHYSICAL_FACTS_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1
```

It also exports these required public functions with their exact ordered inputs:

```text
createCandidateContainmentGuardianLifetimeIdentityV1({
  lifetimeKind,
  stateRootIdentitySha256,
  managerActorEpochSha256,
  bootIdSha256,
  delegatedRootIdentitySha256,
  lifetimeEpochSha256,
  limitsSha256,
  guardianExecutableIdentitySha256,
  guardianControlRequirementsSha256,
  previousLifetimeReplay
})
verifyCandidateContainmentGuardianLifetimeIdentityV1({
  identity, previousLifetimeReplay
})
createCandidateContainmentGuardianLifetimeRecordV1({
  previousLifetimeReplay,
  lifetimeIdentity,
  writerKind,
  writerActorEpochSha256,
  targetSha256,
  recordType,
  operationBytes,
  evidenceBytes
})
verifyCandidateContainmentGuardianLifetimeRecordV1({name, bytes})
replayCandidateContainmentGuardianLifetimeV1({
  segments,
  expectedStateRootIdentitySha256,
  expectedLatestLifetimeEpochSha256,
  expectedLatestRecordSequence,
  expectedLatestRecordRawSha256
})
selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
  lifetimeReplay, generationIdentitySha256
})
selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1({
  lifetimeReplay, targetSha256, recoveryActorEpochSha256
})
selectCandidateContainmentGuardianLifetimeExternalHeadV1({
  lifetimeReplay, targetSha256
})
selectCandidateContainmentGuardianLifetimeNormalCloseReceiptV1({
  lifetimeReplay, targetSha256
})
assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1({
  selection, generationIdentitySha256, targetSha256,
  targetBootIdSha256, targetDelegatedRootIdentitySha256,
  targetLifetimeEpochSha256
})
assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1({
  lifetimeAnchorProjection, lifetimeAttemptAnchorRawSha256,
  targetSha256, recoveryActorEpochSha256
})
assertCandidateContainmentGuardianLifetimeExternalHeadSelectionV1({
  externalHead, targetSha256
})
assertCandidateContainmentGuardianLifetimeNormalCloseReceiptSelectionV1({
  normalCloseDurabilityReceipt, targetSha256
})
assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1({
  recoveryTargetSelection,
  historicalLifetimeAnchorSelections,
  currentLifetimeAnchorSelection,
  externalHead,
  normalCloseDurabilityReceipt
})
```

The value and function identifiers above are the complete required named export
inventory for lifetime-v1. Implementation-private helpers remain unexported.
Harmless standard ESM module metadata that is not an implementation helper or
additional public API is outside this inventory and is not prohibited.

The target selector returns exactly `recoveryTargetProjection` and
`lifetimeTargetRecordRawSha256`. The anchor selector returns exactly
`lifetimeAnchorProjection` and `lifetimeAttemptAnchorRawSha256`. The close selector returns exactly
`normalCloseReceiptProjection` and `normalCloseReceiptRecordRawSha256`. Those
three selector results are exact frozen null-prototype pair values. The external-
head selector returns the exact external-head value directly. A missing,
ambiguous, or wrong-target boundary rejects; selectors never return an
arbitrary first match or null sentinel. The anchor selector addresses the
unique actor epoch and continues to return that historical branded anchor after
a result or successor anchor exists; a later record does not supersede the
immutable boundary needed to replay an older recovery entry. The external-head
selector alone returns the latest head.

Each assertion is the lifetime module's exact cross-module brand API. Target
and close assertions validate their original pair objects, the external-head
assertion validates its selected value, and the anchor assertion validates the
projection's private association plus its separately supplied raw record hash.
It returns the primitive Boolean `true` only when the applicable selected value
or nested projection has the required private `WeakMap` association from a
complete-tail-matched lifetime replay and every expected identity equals that
association. It throws `TypeError` for a missing
or forged brand, mixed pair, wrong originating replay relationship, wrong
target/generation/actor, malformed argument, or any other mismatch; it never
returns `false`, normalizes a lookalike, or upgrades a standalone value. Recovery-
v1 calls these assertions and cannot inspect or mint the private brands.

The boundary-set assertion is the atomic same-origin check. Its target selection
is mandatory. `historicalLifetimeAnchorSelections` is a dense ledger-order array
of zero through four exact carrier records, each with exactly
`lifetimeAnchorProjection` and `lifetimeAttemptAnchorRawSha256`;
`currentLifetimeAnchorSelection` is null or one carrier with those same exact
fields. Those carrier wrappers are constructed by recovery-v1 from its split
API/entry fields and are not themselves branded: the assertion validates each
nested projection's private association and its paired raw hash. `externalHead` and
`normalCloseDurabilityReceipt` are independently null or their exact selected
values. Every applicable pair, value, or nested projection must be associated
with the same originating complete-tail-matched replay instance as the target
selection; byte-equal values selected from two replay calls reject. Each historical anchor remains
selectable by its unique actor and must occur in the replay before any current
anchor. When a current anchor is present, `externalHead` is non-null and equals
the predecessor external head in that anchor's private association. The
assertion returns only `true` or throws `TypeError` under the same rule above.
Recovery-v1 retains target/close selections in module-private metadata,
constructs the exact anchor carrier records from its split fields, and calls
this composite assertion for replay, phase-two planning, close, and terminal
handoff; separately passing every single-boundary assertion is insufficient.

Each segment is exactly `{lifetimeIdentity, records}`; `records` is a dense
ordered array of exact `{name, bytes}` artifacts and no returned wrapper or raw-
hash summary substitutes for one. `segments` is a dense ordered array. The
three expected-tail fields are either all null for structural
replay or all non-null and equal to the latest segment identity/record head;
partial tuples reject. Identity verification reconstructs its derived cgroup
name and identity digest. `previousLifetimeReplay` is a branded replay of the complete exact
segment prefix, including the zero-record replay for a normal genesis or the
complete prior segments before the first record of a reboot successor. Record
creation derives the next sequence and raw predecessor plus all global and per-
target state from that replay and accepts no caller-selected state that is not
valid there. Except for sequence 1 of the zero-record `NORMAL` genesis,
creation requires `previousLifetimeReplay.expectedTailMatched: true`; a
structural nonzero prefix with a null expected tail cannot authorize append or
a successor segment. A standalone verified `{name, bytes}` record is never sufficient
to create a successor. Record verification remains standalone and grants no
chain or plan validation.

The lifetime replay result has exactly these ordered fields:

```text
schema
requirementsSha256
status
stateRootIdentitySha256
segmentCount
recordCount
latestLifetimeEpochSha256
latestLifetimeRecordSequence
latestLifetimeRecordRawSha256
targetCount
targets
internalHashChainsValidated
lifetimeSuccessorBindingsMatched
stateRootIdentityAnchorMatched
expectedTailMatched
tailCompletenessExternallyAnchored
authority
nonclaims
physicalFacts
```

`status` is exactly `NO_LIFETIME_RECORD`, `VALID_LIFETIME_PREFIX_REPLAYED`,
`VALID_LIFETIME_CHAIN_REPLAYED`, or `COMPLETE_LIFETIME_CHAIN_REPLAYED`.
The sole no-record bootstrap input has `segments: []`, one non-null lowercase
`expectedStateRootIdentitySha256`, and all three expected-tail fields null. Its
result has exactly `status: NO_LIFETIME_RECORD`, that expected state-root
identity, `segmentCount: 0`, `recordCount: 0`, all three latest fields null,
`targetCount: 0`, a frozen empty `targets` array,
`internalHashChainsValidated: true`,
`lifetimeSuccessorBindingsMatched: true`,
`stateRootIdentityAnchorMatched: true`, `expectedTailMatched: false`, and
`tailCompletenessExternallyAnchored: false`, plus the exact authority,
nonclaims, and physical facts below. It is privately branded only for normal
identity and sequence-1 record bootstrap; it cannot select a boundary or create
a reboot successor. Every supplied segment must contain at least one record, so
an empty segment, a nonempty segment array with zero total records, a null state-
root anchor, or any non-null bootstrap tail field rejects.

A structurally valid accepted nonempty replay reports the exact latest head,
`internalHashChainsValidated: true`,
`lifetimeSuccessorBindingsMatched: true` even for one segment, and
`stateRootIdentityAnchorMatched: true`. With an all-null expected-tail tuple it
reports `expectedTailMatched: false` and
`tailCompletenessExternallyAnchored: false`. A supplied equal tuple makes both
tail fields true. Any state-root or supplied-tail mismatch throws instead of
returning false or null. Only `LIFETIME_CLOSED_DURABLE` yields the
complete status. Replay applies every applicable exact complete reboot
supersession before assigning a status. That supersession resolves only the
crossed old-segment cgroup-create, launch, and actor-resolution relationships
identified by the grammar; it never resolves an anchor/result or lifetime-
removal/pathname-absence relationship. `VALID_LIFETIME_PREFIX_REPLAYED` means
at least one exact relationship remains structurally open after that step: a
non-superseded intent lacks its observation, a partially launched actor lacks
same-boot terminal resolution and an applicable complete reboot supersession,
an anchor lacks its result, a termination lacks reap-or-parentage-lost and an
applicable complete reboot supersession, a result-publishing recovery actor
lacks terminal resolution and an applicable complete reboot supersession, or a
removal intent lacks pathname absence. A successfully initialized live normal
guardian is a stable boundary rather than a partially launched actor.
`VALID_LIFETIME_CHAIN_REPLAYED` means the chain is nonclosed and every
relationship started so far is at an exact stable boundary after that same
supersession step, including configured/initialized context, target genesis,
result plus required actor resolution, definite not-created, complete reboot
catch-up and supersession, normal-close receipt, or pathname absence awaiting
closure. The predicates are mutually exclusive and exhaustive. Internal
validation never substitutes for expected-tail matching.

Each target entry has exactly these ordered fields:

```text
generationIdentitySha256
targetSha256
recoveryTargetProjection
lifetimeTargetRecordRawSha256
currentBootIdSha256
currentDelegatedRootIdentitySha256
currentLifetimeCgroupIdentitySha256
bootTransitionCount
attemptCount
latestExternalHead
attemptAnchors
normalCloseReceipt
normalCloseReceiptRecordRawSha256
```

Each attempt-anchor entry has exactly `recoveryActorEpochSha256`,
`lifetimeAnchorProjection`, and `lifetimeAttemptAnchorRawSha256`. Targets and
anchors are ordered by their first ledger sequence. The target projection and
target-record raw hash equal its unique generation-head record and never change.
Same-boot anchors repeat the configured context. Each proved reboot consumes a
new `REBOOT_RECOVERY` segment and one transition projection per target, but one
later chain event may catch a target up across multiple crash-interrupted
segments. A target first introduced after reboot embeds that contiguous array
in its genesis event; all later anchors on the final boot repeat its boot,
delegated-root, epoch, and lifetime-cgroup identities. The target and external
head survive a transition unchanged. Only `RECOVERY_ONLY_GUARDIAN` is permitted
after the first reboot or recovery-only actor. Attempts and boot transitions
are each capped at four per target.

One lifetime admits at most six targets. Its semantic append budget is exact:
25 lifetime-wide records plus 37 records for each of six targets, or 247 total.
Admission of a seventh target waits for this lifetime to close and a fresh,
independent normal lifetime to be established; it cannot create an unratified
same-boot continuation segment or borrow structural capacity.
The 25 lifetime-wide records conservatively cover the eight-record normal
setup/adoption branch, three records for each of four reboot segments, two
normal-actor resolution records, and the three-record removal/path-absence/
closure suffix. A target's 37 records cover one genesis, four separate worst-
case reboot catch-up records, and four eight-record recovery-only attempts
(anchor, launch intent, pidfd, exec, membership, result, termination, and reap
or parentage-lost); the mutually exclusive one-record normal-close branch is
smaller. These are reservation ceilings, not claims that every branch executes
every record.

Before creating any lifetime record, replay classifies the proposed record into
the global or one target bucket and first computes `prospectiveConsumed` as the
applicable already-consumed bucket count plus that one candidate; the candidate
is never counted again. It applies the candidate's structural transition in
memory, then derives the longest still-admissible completion suffix strictly
after the candidate. The prospective global record count plus its suffix, the
applicable prospective per-target record count plus its suffix, and the
prospective aggregate record count plus the post-candidate completion suffixes
of the global bucket and every admitted target bucket must remain within 25,
37, and 247 respectively. A target-genesis candidate adds its new bucket to
that aggregate calculation; target buckets not yet admitted contribute zero.

A normal-genesis candidate begins the eight-record normal setup reservation,
so its global suffix contains the other seven records. A candidate in a begun
normal setup leaves only the remainder after that candidate. The global suffix
also counts the remainder after a candidate in a begun three-record reboot
setup plus three for each not-yet-begun reboot still permitted by the four-
transition limit, the remaining normal-actor resolution records up to its two-
record ceiling, and the remaining lifetime-close records up to its three-
record ceiling. An anchor candidate begins one eight-record attempt reservation,
so its target suffix contains the other seven records plus eight for each not-
yet-anchored attempt still permitted by the four-attempt limit and one catch-up
record for every remaining transition. A target-genesis candidate requires an
unused target slot and starts its complete 37-record bucket: its suffix is the
remaining 36 records. A terminal result is already one of its attempt's eight
records. The one-record normal-close branch is a mutually exclusive maximum
instead of an addition to the recovery-attempt branch. Creation rejects before
canonical bytes if any prospective count plus its strictly post-candidate
suffix could exceed 25, 37, or 247.
Because 247 is below the per-segment structural ceiling of 256, even adversarial
concentration in one segment retains closure capacity; the 1,280 aggregate
ceiling remains only a pre-parse corruption/resource bound. Accepted semantic
replay rejects record 248 and targets seven onward as plan surplus rather than
returning a stranded valid prefix. The evaluator independently exercises every
budget boundary and production derives the same accounting from replay state.

The selector functions require the exact branded replay with
`expectedTailMatched: true`. Module-private `WeakMap` entries associate each
returned pair and projection with its exact record raw hash, applicable
predecessor external head, and originating replay;
recovery cannot mix the projection from one valid record with another valid
record's raw hash. Selectors return recursively frozen copy-on-read values.
Structural replay exposes normalized public target summaries but issues no
recovery-accepted boundary brand when the expected tail is null. A brand proves
only complete pure replay normalization and pair equality—not origin,
durability, exclusive lock, boot truth, execution, cgroup state, or authority.

The lifetime requirements value has exactly these ordered fields:

```text
schema
identitySchema
contextSchema
recordSchema
replaySchema
rebootTransitionSchema
rebootTransitionChainEventSchema
partialLaunchResolutionSchema
noChildLaunchFailureSchema
targetGenesisInventorySchema
recoveryTargetProjectionSchema
targetGenesisEventSchema
anchorEventSchema
anchorProjectionSchema
normalCloseReceiptProjectionSchema
externalHeadSchema
journalV2RequirementsSha256
guardianControlRequirementsBindingRule
authoritySha256
nonclaimsSha256
physicalFactsSha256
recordFilename
embeddedBytesEncoding
rawHashAlgorithm
semanticHashAlgorithm
bindingHashAlgorithm
operationArtifactSchemaPattern
evidenceArtifactSchemaPattern
operationBindingSchema
evidenceBindingSchema
operationAndEvidencePayloadShape
sequenceStartsAt
sequenceWidth
maximumLifetimeSegments
maximumRecordsPerSegment
maximumRecordsAcrossSegments
maximumControlValueBytes
maximumOperationOrEvidenceBytes
maximumRecordBytes
maximumAggregateRecordBytes
maximumRecoveryAttemptsPerTarget
maximumBootTransitionsPerTarget
maximumTargetsPerLifetime
maximumSemanticGlobalRecords
maximumSemanticRecordsPerTarget
maximumSemanticRecordsAcrossLifetime
minimumLifetimeClosureReserve
genesisRawSha256
lifetimeKinds
writerKinds
recordTypes
replayStatuses
noChildErrnoNames
lifetimeBoundaryBrandProtocol
recordTypeRelationshipMatrixSha256
structuralTailOptional
completeTailRequiredForBoundarySelection
completeTailRequiredForRecordCreation
recordGrammarRule
actorWriterHandoffRule
replayStatusRule
perBootTransitionRule
rebootTransitionCatchupRule
rebootSupersessionRule
configuredContextRule
targetGenesisInventoryRule
targetGenesisEventRule
recoveryTargetProjectionRule
recoveryTargetUniquenessRule
targetSelectorPairRule
boundarySetAssertionRule
targetRebootTransitionRule
partialLaunchResolutionRule
anchorPairRule
externalHeadProgressionRule
normalCloseReceiptRule
appendReserveRule
filesystemMechanicsImplemented
cgroupMechanicsImplemented
guardianExecutionProven
boundaryOriginProven
runtimeRegistrationPermitted
qualificationPermitted
promotionPermitted
publicationPermitted
```

The journal-v2 digest is the exact literal above. The guardian-control binding
rule is `non-null-exact-sha-bound-identically-across-segments/v1`; lifetime-v1
binds but does not authenticate that future contract. Algorithms and filename
rules equal recovery-v1. The two artifact-schema patterns are exactly
`oxigraph.candidate-containment-guardian-lifetime-operation/<lower-kebab-record-type>/v1`
and
`oxigraph.candidate-containment-guardian-lifetime-evidence/<lower-kebab-record-type>/v1`;
the two binding schemas are exactly
`oxigraph.candidate-containment-guardian-lifetime-operation-binding/v1` and
`oxigraph.candidate-containment-guardian-lifetime-evidence-binding/v1`; and the
payload shape is `opaque-bounded-canonical-json`. Numeric values are exactly `1`, `16`, `5`, `256`,
`1280`, `16384`, `16384`, `65536`, `83886080`, `4`, `4`, `6`, `25`, `37`,
`247`, and `3` in the ordered numeric fields
above, and genesis is 64 ASCII zeroes. Arrays are exactly the vocabularies in
their declared order; `noChildErrnoNames` is exactly
`[EACCES, EAGAIN, EBUSY, EINVAL, ENOMEM, ENOSYS, EOPNOTSUPP, EPERM]`.
`lifetimeBoundaryBrandProtocol` is
`complete-tail-matched-lifetime-replay-weakmap-pair-brand/v1`;
`recordTypeRelationshipMatrixSha256` is the evaluator-owned canonical semantic
SHA-256 of the exact ordered table above represented as dense null-prototype
records with exactly `recordType`, `writerRule`, `targetRule`, and
`predecessorRule`. Each string is the exact corresponding table-cell text after
ASCII edge trimming, with no Markdown markup. Production constructs and hashes
the same array independently rather than importing the golden digest.
`recordGrammarRule` is
`segment-genesis-then-intent-before-observation;reboot-successor-requires-complete-tail-matched-nonclosed-predecessor-without-removal-intent-or-path-absence;removal-intent-then-path-absence-then-close-in-same-segment-with-no-successor;launch-intent-then-definite-not-created-or-honest-launch-prefix;unique-generation-target-genesis-by-live-normal-or-service-manager-after-normal-resolution-or-bounded-proved-reboot-catchup;actor-written-target-head-or-live-anchor-requires-normal-adoption;anchor-before-optional-launch;actor-written-result-requires-live-adoption-or-recovery-launch-through-membership-and-no-resolution-or-supersession;manager-direct-pretemp-empty-or-not-created-result-only-for-recovery-only-anchor;manager-live-birth-result-only-after-normal-resolution-or-reboot-supersession;manager-launched-recovery-result-only-after-recovery-resolution-or-reboot-supersession;result-may-precede-terminal-resolution;successor-anchor-requires-result-and-iff-launch-intent-not-created-or-same-boot-termination-then-reap-or-parentage-lost-or-target-reboot-supersession;abandoned-prelaunch-anchor-becomes-anchored-empty-only-after-restored-exact-absent-or-empty-pre-temp-observation;same-boot-partial-launch-terminal-resolution-requires-reported-lock-reacquisition-and-lifetime-cgroup-empty-identity;proved-reboot-supersession-forbids-old-boot-process-records-and-permits-exact-directory-derived-result;normal-termination-may-precede-target-terminal;recovery-only-after-live-requires-normal-resolution-or-target-reboot-supersession;normal-resolution-is-not-created-or-same-boot-termination-then-reap-or-parentage-lost;all-targets-terminal-and-no-open-anchor-result-or-current-recovery-launch-and-current-normal-guardian-resolved-or-reboot-superseded-then-removal-intent-then-path-absent-then-closed;target-terminal-rejects-new-attempt-but-permits-required-actor-resolution-reboot-catchup-and-lifetime-closure;lifetime-terminal-rejects-successor/v1`;
`replayStatusRule` is
`zero-records:no-lifetime-record;apply-exact-reboot-supersession-only-to-crossed-old-segment-cgroup-create-launch-and-actor-resolution;nonclosed-any-remaining-open-nonsuperseded-intent-partial-launch-anchor-without-result-termination-without-reap-or-parentage-lost-result-publishing-recovery-actor-without-resolution-or-removal-without-path-absence:valid-lifetime-prefix-replayed;nonclosed-all-started-relationships-stable-or-exactly-reboot-superseded:valid-lifetime-chain-replayed;lifetime-closed:complete-lifetime-chain-replayed/v1`;
and `perBootTransitionRule` is
`same-boot-repeat-context;proved-reboot-new-segment-and-one-transition-projection-per-target-counted-through-direct-or-catchup-event;recovery-only-after-reboot-or-recovery-only;old-boot-process-records-forbidden/v1`.
The remaining exact rule strings are:

```text
configuredContextRule = identity-state-root-boot-delegated-equal;non-null-reported-lifetime-cgroup;digest-covers-prefix/v1
actorWriterHandoffRule = live-target-anchor-result-requires-initialization-adopted-and-no-not-created-termination-or-reboot;recovery-actor-result-requires-anchor-launch-intent-pidfd-exec-membership-and-no-not-created-termination-or-reboot;manager-direct-never-launched-pretemp-empty-or-not-created-result-only-for-recovery-only-anchor;manager-live-birth-result-only-after-normal-terminal-resolution-or-target-reboot-supersession;manager-launched-recovery-result-only-after-recovery-terminal-resolution-or-target-reboot-supersession/v1
rebootTransitionCatchupRule = dense-one-through-four;first-previous-equals-target-context-and-segment-head;adjacent-items-equal-every-intervening-segment-identity-optional-configured-context-and-head;final-current-equals-record-configured-context;prior-count-plus-length-at-most-four;no-old-segment-append/v1
rebootSupersessionRule = complete-catchup-to-configured-newest-segment;every-crossed-boot-and-epoch-differs;every-crossed-previous-lifetime-control-job-absent;no-old-boot-termination-reap-parentage-or-exit-claim;service-manager-may-bind-exact-directory-derived-result-and-recovery-only-successor/v1
targetGenesisInventoryRule = recovery-directory-present;entry-count-zero;existing-lifetime-target-head-false/v1
targetGenesisEventRule = projection-and-inventory-target-equal;normal-live-or-resolved-manager-has-empty-transition-array;reboot-service-manager-has-complete-dense-catchup-array;genesis-head-is-no-recovery-attempt/v1
recoveryTargetProjectionRule = generation-manifest-target-boot-delegated-root-lifetime-epoch-and-four-normal-head-fields-equal-reverified-target-and-normal-context-or-catchup-origin;digest-covers-prefix/v1
recoveryTargetUniquenessRule = exactly-one-target-per-generation-identity-across-all-segments;target-sha-not-reused-across-generation-identities/v1
targetSelectorPairRule = complete-tail-replay-selects-generation-unique-projection-and-genesis-record-raw-weakmap-pair/v1
boundarySetAssertionRule = target-required;historical-anchor-carriers-dense-ledger-order-and-brand-nested-projection-plus-raw;optional-current-carrier-head-close;same-originating-replay-instance;current-anchor-predecessor-equals-external-head;byte-equal-cross-replay-rejects/v1
targetRebootTransitionRule = every-item-boot-and-lifetime-epoch-differ;configured-flags-control-nullability;state-root-stable;prior-lifetime-control-job-absent;target-and-external-head-stable;complete-chain-supersedes-old-target-actor-without-process-claim;permits-exact-directory-derived-result/v1
partialLaunchResolutionRule = same-boot-replacement-only;lock-reacquired;prior-manager-absent;lifetime-cgroup-identity-equal-and-empty;no-reap-or-exit-status-claim/v1
anchorPairRule = weakmap-projection-to-originating-replay-and-record-raw;actor-directory-fresh;predecessor-equals-latest-external-head/v1
externalHeadProgressionRule = genesis-no-attempt;one-result-per-anchor;result-before-successor;terminal-rejects-new-attempt-but-permits-required-actor-resolution-reboot-catchup-and-lifetime-closure/v1
normalCloseReceiptRule = target-genesis;zero-attempts;zero-through-four-exact-replay-derived-transitions-ending-current-context;active-to-closed;both-parent-syncs-and-closed-reobservation-true/v1
appendReserveRule = before-create-classify-candidate-global-or-target;prospective-consumed-equals-already-consumed-plus-candidate;apply-candidate-transition-then-count-suffix-strictly-after-candidate;normal-genesis-starts-eight-with-seven-remaining;begun-normal-or-reboot-setup-counts-only-remainder-after-candidate;three-for-each-not-yet-begun-of-four-permitted-reboots;remaining-to-two-normal-actor-resolution;remaining-to-three-close;prospective-global-plus-post-candidate-suffix-at-most-25;target-genesis-starts-thirty-seven-with-thirty-six-remaining;anchor-starts-eight-with-seven-remaining;eight-for-each-not-yet-anchored-of-four-permitted-attempts;one-catchup-per-remaining-transition;terminal-result-already-inside-attempt-eight;one-record-normal-close-is-mutually-exclusive-maximum-not-additive;prospective-target-plus-post-candidate-suffix-at-most-37;target-count-at-most-six;prospective-aggregate-plus-post-candidate-global-and-every-admitted-target-suffix-at-most247;target-genesis-adds-new-bucket;unadmitted-targets-contribute-zero;global25-plus-six-times-target37-equals247-less-than-segment256;reject-before-canonical-bytes/v1
```

Structural tail optionality, the boundary-selection tail requirement, and the
record-creation tail requirement are true. Every mechanics, proof, authority, registration, qualification,
promotion, and publication field is false. The red suite owns the literal
requirements digest and production computes it independently from this exact
projection.

Lifetime replay authority has exactly these ordered keys, all false:

```text
mayPersistLifetimeRecord
mayConsumeLifetimeEpoch
mayCreateLifetimeCgroup
mayRemoveLifetimeCgroup
mayLaunchGuardian
mayReapGuardian
mayPersistRecoveryTarget
mayPersistRecoveryAnchor
mayPersistRecoveryHead
mayPersistNormalCloseReceipt
mayMutateStateFilesystem
mayMutateDelegatedCgroup
mayExecuteRecoveryPlan
mayRegisterRuntime
mayQualify
mayPromote
mayPublish
productionContainment
```

Its nonclaims have exactly these ordered keys, all false:

```text
serializedReplayProvesArtifactOrigin
serializedReplayProvesFilesystemDurability
serializedReplayProvesExclusiveStateRootLock
serializedReplayProvesBootIdentity
serializedReplayProvesDelegatedRootIdentity
serializedReplayProvesLifetimeCgroupIdentity
serializedReplayProvesFreshEpoch
serializedReplayProvesGuardianExecution
serializedReplayProvesGuardianParentage
serializedReplayProvesGuardianReap
parentageLostObservationProvesReap
serializedReplayProvesRecoveryTargetOrigin
serializedReplayProvesRecoveryHeadOrigin
serializedReplayProvesNormalCloseMechanics
selectedBoundaryProvesPhysicalFact
tailDeletionExcludedWithoutExpectedHead
```

Its physical-fact value has exactly these ordered keys and values:

```text
stateRootIdentityObserved: null
stateFilesystemInterfaceAvailable: null
lifetimeEpochConsumed: null
lifetimeRecordPersisted: null
lifetimeRecordFilesystemDurability: null
lifetimeCgroupConfigured: null
lifetimeCgroupPathAbsent: null
guardianExecuted: null
guardianReaped: null
guardianParentageLost: null
recoveryTargetPersisted: null
recoveryAnchorPersisted: null
recoveryHeadPersisted: null
normalCloseReceiptPersisted: null
bootTransitionObserved: null
physicalEligibility: false
productionContainment: false
```

Counts and aggregate byte lengths are checked before JSON parsing, base64
decoding, hashing, sorting, or aggregate allocation. Every returned object is
an exact recursively frozen null-prototype value; every returned byte view is
copy-on-read. The pure lifetime contract is an evaluator-owned structural seam,
not the native lifetime owner described later in this ADR.

Every lifetime identity, context, transition, transition-chain event, launch-
resolution, no-child, recovery-target projection, target-genesis inventory and
event, anchor-event, anchor projection, external head, and close-
receipt canonical value admits at most the 16-KiB control-value bound including
its final LF. Replay summaries are in-memory exact values bounded by the segment,
record, target, attempt, transition, and aggregate-record ceilings; they are not
accepted as serialized durable artifacts.

The held state root has exactly six owner-created directories named
`lifetimes`, `staging`, `active`, `closed`, `recovered`, and `quarantined`; the
exclusive lock is held on the already-open state-root directory itself and
introduces no lock pathname. Generation directory names are the full
generation-identity digest. A generation cannot appear in more than one
lifecycle directory. Unknown root entries, duplicate generations,
temporary-file residue outside the exact bounded staging grammar, aliases, or
unsafe state-filesystem metadata block admission and recovery rather than being
ignored or converted into a selected generation move. Malformed or noncanonical
serialized input is rejected; a canonical lifecycle-inventory observation that
reports zero/multiple locations or unsafe entries returns only
`UNSAFE_FILESYSTEM_INVENTORY_BLOCKED`. A distinct, bounded delegated-cgroup
inventory failure may produce durable `QUARANTINE` only after one exact safe
lifecycle source has already been selected. Neither outcome grants mutation
authority.

Recovery uses a separate recovery-ledger v1 lineage. The exact schemas are
`oxigraph.candidate-containment-recovery-target/v1`,
`oxigraph.candidate-containment-recovery-inventory-observation/v1`,
`oxigraph.candidate-containment-recovery-attempt/v1`,
`oxigraph.candidate-containment-recovery-anchored-empty-attempt/v1`,
`oxigraph.candidate-containment-guardian-lifetime-recovery-target-projection/v1`,
`oxigraph.candidate-containment-lifetime-recovery-attempt-anchor-projection/v1`,
`oxigraph.candidate-containment-lifetime-normal-close-receipt-projection/v1`,
`oxigraph.candidate-containment-recovery-plan/v1`,
`oxigraph.candidate-containment-recovery-record/v1`,
`oxigraph.candidate-containment-recovery-replay/v1`,
`oxigraph.candidate-containment-recovery-external-head/v1`, and
`oxigraph.candidate-containment-recovery-requirements/v1`. The pure module
exports create/verify functions for target, inventory observation, attempt,
anchored-empty descriptor, and record plus exact plan and replay functions.
Every output remains descriptive and authority-null; only
the later native physical owner may turn verified bytes and held descriptors
into filesystem or cgroup facts.

#### Recovery target, attempt, and bounds

The immutable target has exactly these ordered fields:

```text
schema
generationManifestRawSha256
generationIdentity
generationIdentitySha256
birthGuardianEpochSha256
bootIdSha256
admissionGenerationSha256
controlGenerationSha256
jobGenerationSha256
latestBundleSequence
latestBundleRawSha256
latestInnerRecordRawSha256
latestNormalState
targetSha256
```

All repeated identity fields must equal the independently verified immutable
manifest. The four latest-normal-head fields are either all null for genesis or
all non-null and equal to one verified journal-v2 replay head. A non-null
sequence is the exact 16-digit sequence in the range 1 through 18, the two heads
are lowercase SHA-256 values, and the normal state is the unchanged-v1 state at
that sequence. `targetSha256` is the canonical SHA-256 of all preceding target
fields. No source location participates in this digest: a correct recovery move
changes location without changing its immutable target.

The exact attempt object has these ordered fields:

```text
schema
targetSha256
actorKind
recoveryActorEpochSha256
attemptDirectoryName
lifetimeAttemptAnchorRawSha256
previousRecoveryActorEpochSha256
previousAttemptDirectoryName
previousRecoveryRecordSequence
previousRecoveryRecordRawSha256
reportedCurrentBootIdSha256
reportedStateRootIdentitySha256
reportedDelegatedRootIdentitySha256
reportedLifetimeCgroupIdentitySha256
disposition
reportedSourceLocation
decisionSourceLocation
reportedLifecycleInventorySha256
reportedCommandDescriptorHeld
reportedStatusDescriptorHeld
reportedSupervisorPidfdHeld
reportedDirectChildWaitAuthority
reportedCgroupInventorySafe
reportedControlCgroupPresent
reportedJobCgroupPresent
reportedStateFilesystemInterfaceAvailable
reportedRecoveryInterfaceAvailable
derivedPriorEffectOutcomeCertain
quarantineReason
attemptSha256
```

`actorKind` is exactly `LIVE_BIRTH_GUARDIAN` or
`RECOVERY_ONLY_GUARDIAN`; the fresh recovery actor differs from the target's
birth epoch, and its full lowercase digest is the attempt-directory name. The
lifetime-attempt anchor is a non-zero SHA-256. State-root and current
recovery-lifetime-cgroup identities are always SHA-256 values and must equal
their independently supplied expected identities; unknown or drifted identity
authorizes no new anchor or actor allocation, actor launch, directory creation,
recovery-ledger write, or move. A previously durable matching anchor remains
consumed. If it never begins record-1 temporary persistence and is later
observed exactly absent or empty, it follows the anchored-empty rule; any temp
or other residue stays unsafe and cannot be normalized to empty.
Current boot and delegated-root identity are
either SHA-256 values or null. On the same boot, a null or mismatched
delegated-root identity permits only `QUARANTINE` and no delegated-root
mutation. On a verified different boot, the reported current delegated root
must equal its current expected identity but need not equal the target's
historical delegated-root identity; this produces the bounded
`REBOOT_INTERRUPTION` plan only with a recovery-only actor, both historical
target cgroup paths reported absent, and no delegated-root mutation. A
replacement actor sets all four descriptor, pidfd, and direct-wait booleans
false. Direct-wait authority implies a live-birth actor and a held pidfd.

`reportedCgroupInventorySafe`,
`reportedStateFilesystemInterfaceAvailable`,
`reportedRecoveryInterfaceAvailable`, and
`derivedPriorEffectOutcomeCertain` are exact booleans.
`reportedStateFilesystemInterfaceAvailable` means that the separately probed
local state-filesystem operations required by this contract are available;
`reportedRecoveryInterfaceAvailable` means only that the non-filesystem
descriptor, pidfd/wait, and delegated-cgroup observation/control interfaces
selected by the derived non-quarantine branch are available. Control and job
presence are independent booleans when cgroup inventory is safe and are both
null when it is unsafe; mixed boolean/null pairs are rejected. Every
anchor-required, ready, close, closed, or terminal handoff requires the state-
filesystem interface true. Genesis, same-boot, and reboot additionally require
safe inventory and replay-derived certainty true; the recovery-interface flag
must be true whenever the derived branch selects any such non-filesystem
operation and is otherwise ignored by its filesystem-only plan. Recovered-
decision resume requires safe `00` inventory and certainty true but may preserve
the recovery interface false because its remaining plan is filesystem-only.
Quarantine records the exact booleans; quarantine-decision resume may preserve
false safety, recovery interface, or certainty and null cgroup presence because
it performs no delegated-root effect. A fresh false recovery-interface report
on a branch that would otherwise require one selects the exact
`UNSUPPORTED_RECOVERY_INTERFACE` quarantine reason; it never doubles as a state-
filesystem failure.

`disposition` is exactly `GENESIS_ABORT`, `SAME_BOOT_RECONCILE`,
`REBOOT_INTERRUPTION`, `QUARANTINE`, `RECOVERED_DECISION_RESUME`, or
`QUARANTINE_DECISION_RESUME`. Source location is exactly `staging`, `active`,
`recovered`, or `quarantined` and must equal the one verified location in the
exact lifecycle-inventory observation whose canonical digest is
`reportedLifecycleInventorySha256`. For a fresh disposition,
`decisionSourceLocation` equals that exact `staging` or `active` source. For an
inherited-decision resume it equals the first ancestor's immutable decision
source even when the currently observed source is the matching destination.
It is never caller-selected or changed by a successor. `quarantineReason` is null outside
`QUARANTINE`; otherwise it is exactly one of `UNKNOWN_BOOT_ID`,
`DELEGATED_ROOT_IDENTITY_UNKNOWN_OR_DRIFTED`,
`UNSAFE_CGROUP_INVENTORY`, `INCONSISTENT_GENERATION_STATE`,
`UNSUPPORTED_RECOVERY_INTERFACE`, or `RECOVERY_EFFECT_UNCERTAIN`.
`attemptSha256` is the canonical SHA-256 of every preceding attempt field.

The lifecycle-inventory observation has exactly `schema`,
`generationIdentitySha256`, `stagingPresent`, `activePresent`, `closedPresent`,
`recoveredPresent`, `quarantinedPresent`, `unsafeEntriesPresent`, and
`inventorySha256`; its final digest covers every preceding field. Finalized
attempt creation requires exactly one presence boolean true,
`unsafeEntriesPresent: false`, and an allowed source for the selected
disposition. Zero or multiple locations, an unsafe entry, an unverified
manifest/normal/recovery chain, or an unknown or drifted state root never
creates an attempt. Zero/multiple/unsafe inventory returns only the
authority-null planner result `UNSAFE_FILESYSTEM_INVENTORY_BLOCKED`; unknown or
drifted state root returns `STATE_ROOT_IDENTITY_REJECTED`; and malformed or
corrupt manifest/journal/replay input is rejected before a plan value exists.
An unavailable or drifted current recovery-lifetime identity returns
`RECOVERY_LIFETIME_IDENTITY_REJECTED` before attempt creation.
After those checks, a false state-filesystem-interface report returns only
`STATE_FILESYSTEM_INTERFACE_REJECTED` and authorizes no new anchor or actor
allocation, actor launch, attempt, quarantine, close, or move.
Such an outcome
blocks admission and launches no recovery actor, creates no new attempt
directory or record, and performs no move; it never invents one source location
to persist a quarantine decision. Any already durable matching anchor remains
consumed and is handled exactly as described below.

The first-ever finalized attempt binds null previous actor, directory, and
sequence plus an all-zero previous raw head. A successor after a non-empty
attempt binds its exact actor, directory, final 16-digit sequence, and final raw
head. A successor after an anchored empty attempt binds that actor and
directory, null sequence, and the all-zero raw head. Partial-null predecessor
tuples are rejected.

Every attempt first requires an independently verified
`oxigraph.candidate-containment-lifetime-recovery-attempt-anchor-projection/v1`
from the lifetime ledger. Its serialized projection has exactly `schema`,
`targetSha256`, `actorKind`, `recoveryActorEpochSha256`,
`attemptDirectoryName`, `expectedStateRootIdentitySha256`,
`expectedCurrentBootIdSha256`,
`expectedDelegatedRootIdentitySha256`,
`expectedLifetimeCgroupIdentitySha256`,
`previousRecoveryActorEpochSha256`, `previousAttemptDirectoryName`,
`previousRecoveryRecordSequence`, and `previousRecoveryRecordRawSha256`; the
lifetime-ledger verifier separately returns the anchor record's raw SHA-256.
The recovery attempt and empty descriptor exactly equal the projection's
target, actor kind, actor epoch, directory, and four predecessor fields and bind
the separately returned raw hash. A finalized attempt additionally requires
reported state-root and recovery-lifetime identity equal to their expected
projection values. Reported boot and delegated-root identity are compared, not
blindly equated. A fresh same-boot branch compares both to the applicable
current projection and also requires the current projection to equal the
historical target. A `REBOOT_INTERRUPTION`, or either inherited-decision resume
after a lifetime-proved boot boundary, compares non-null reports to that entry's
current projection rather than the historical target. Fresh `QUARANTINE` may
retain the exact null or mismatched relationship that selected its reason. A
matching `QUARANTINE_DECISION_RESUME` may retain null or mismatched reports
because it performs no delegated-root effect; the durable ancestry, not a new
null reason, supplies its decision and original reason. State-root and current
recovery-lifetime identity remain exact for both resumes. The empty descriptor has
no boot/root observation fields and therefore binds only its present static
launch/predecessor fields. The prelaunch projection never binds an attempt SHA,
disposition, source location, root/cgroup observation, or held-descriptor fact
that does not exist yet.

The lifetime-ledger normal-close receipt projection has exactly `schema`,
`targetSha256`, `sourceLocation`, `destinationLocation`,
`activeParentSynced`, `closedParentSynced`, and
`closedLocationReobserved`; source/destination are exactly `active`/`closed`
and all three booleans are true. The lifetime verifier separately returns its
raw record hash and module brand. A closed state-18 directory is terminal only
when this complete branded receipt binds the same target. The recovery module
cannot construct or infer it from lifecycle inventory.

A durable lifetime anchor allocation that never begins record-1 temporary-file
persistence—whether because the actor crashed, launch did not occur, or phase-
two capability or identity checks rejected it—is represented by an exact
anchored-empty descriptor only after the state-filesystem interface is restored
and the directory is exactly observed absent or empty; it is never reconstructed
as a full attempt. An anchor with missing finalized record 1 but any temporary
or other residue instead remains blocked or quarantined under the exact
filesystem grammar. For a recovery-only anchor, the manager may bind the direct
never-launched empty result only while lifetime replay contains no launch intent.
For a live-birth anchor, the initialized guardian is already running: only that
matching actor may bind the empty result while live, and the manager may do so
only after exact normal-guardian same-boot terminal resolution or target reboot
supersession. Constructing this authority-null recovery descriptor alone never
upgrades manager writer eligibility. The anchored-empty descriptor
has exactly `schema`, `targetSha256`, `actorKind`,
`recoveryActorEpochSha256`, `attemptDirectoryName`,
`lifetimeAttemptAnchorRawSha256`, `previousRecoveryActorEpochSha256`,
`previousAttemptDirectoryName`, `previousRecoveryRecordSequence`,
`previousRecoveryRecordRawSha256`, `reportedAttemptDirectoryState`,
`latestRecoveryRecordSequence`, and `latestRecoveryRecordRawSha256`. Directory
state is exactly `ABSENT` or `PRESENT_EMPTY`; latest sequence is null and latest
raw head is all zero. The descriptor contains no attempt SHA, disposition,
boot/root observation, source location, descriptor authority, or cgroup
observation. Its static launch and predecessor fields must equal an
independently verified lifetime-ledger anchor projection rather than merely a
caller-supplied raw digest.

The physical ordering is lifetime-anchor record durable, create the exact
attempt directory, sync the recovery parent, then begin record-1 temporary-file
persistence. Only a stop before record-1 temporary-file creation can later
yield an anchored `ABSENT` or `PRESENT_EMPTY` descriptor. Either exact empty
outcome consumes one attempt, the actor is never launched later, relaunched, or
reincarnated, and a successor binds that actor and directory with null sequence
and the all-zero head. A crash during temporary-file persistence leaves bounded
temporary residue and is unsafe inventory: it blocks or quarantines according
to the exact filesystem grammar and is never reclassified as anchored-empty.
A finalized record-1 entry follows finalized-attempt verification instead.
While the state-filesystem interface is unavailable, the manager waits without
inventing the descriptor or reusing the actor; only an exact later observation
can finalize the empty entry. An unanchored empty directory is unsafe inventory
and blocks recovery.

One generation admits at most four attempts including anchored empty attempts,
24 finalized records in one attempt, and 96 finalized recovery records across
all attempts. Per-attempt record sequences use 16 decimal digits from 1 through
24 and an all-zero in-attempt genesis raw head. Each operation and evidence
artifact admits at most 16 KiB including its final LF; a complete recovery
record admits at most 64 KiB. Embedded bytes use strict padded canonical RFC
4648 base64, and each final filename is
`<16-digit-sequence>-<record-raw-sha256>.jsonl`. A fifth attempt, 25th record,
97th global record, surplus valid-looking branch record, unknown state, or
oversized artifact is rejected rather than reinterpreted.

Target, inventory-observation, lifetime-anchor-projection, attempt,
anchored-empty, plan-header, replay-header, and external-head canonical JSONL
values each admit at most 16 KiB including the final LF. Replay admits at most
four tagged entries, four lifetime projections, four inventory observations
derived from record 1, and 96 record references; the sum of raw finalized
record bytes admits at most 6,291,456 bytes. Counts and raw byte lengths are
checked before JSON parsing, base64 decoding, hashing, sorting, or aggregate
allocation. The 24/96 record ceilings are structural corruption and resource
reserves. The currently ratified semantic maximum is 19 records per fresh
attempt. Terminal states prohibit successors and nonterminal crash prefixes
shorten later plans, so no valid lineage can reach the 96-record structural
ceiling. Records 20 through 24 in one attempt and any aggregate suffix not
derived by the exact per-attempt replay remain structurally bounded but
semantically rejected as plan surplus; the evaluator enumerates all bounded
four-attempt branch combinations rather than assuming `4 × 19` is valid.

#### Exact pure API and values

Target, inventory, plan, attempt, anchored-empty, and replay results are exact,
recursively frozen null-prototype values. A recovery record alone is a
canonical single-LF JSONL copy-on-read artifact. Its wrapper is itself a frozen
null-prototype object: `bytes` is an enumerable own getter that returns a fresh
exact `Buffer` copy on every read, and every other public property is enumerable
own data. It has exactly these ordered
public properties: `bytes`, `name`, `rawSha256`, `semanticSha256`, `schema`,
`sequence`, `recordType`, `priorState`, `nextState`,
`previousRecordRawSha256`, `targetSha256`, `attempt`, `operation`, `evidence`,
`standaloneRecordHashChainValidated: false`, `planValidated: false`, and
`embeddedArtifactBindingsValidated: true`. Its canonical bytes contain only
the ten record fields listed below. Standalone verification never upgrades
chain or plan validation. Input objects and arrays are dense, exact-key,
ordinary data only: foreign prototypes, accessors, symbols, proxies, sparse
arrays, aliased or mutable byte views, and post-call mutation are rejected or
defensively copied.

Module-private brands distinguish normalized target, inventory, plan, attempt,
anchored-empty, and replay outputs from caller-forged lookalikes. Each public
create/verify/replay function returns a branded value; downstream functions
accept only the applicable returned value or independently reconstruct it
through the listed verifier and source artifacts. Serialized record references
remain the deliberate exception and are always re-decoded and re-verified from
`{name, bytes}`. A brand proves only in-process normalization, never external
origin, persistence, durability, or authority.

The module exports the exact schemas, bounds, ordered vocabularies, immutable
authority/nonclaim/physical-fact values, immutable requirements value and its
canonical SHA-256 under exactly these required public value identifiers:

```text
CANDIDATE_CONTAINMENT_RECOVERY_TARGET_SCHEMA_V1
CANDIDATE_CONTAINMENT_RECOVERY_INVENTORY_OBSERVATION_SCHEMA_V1
CANDIDATE_CONTAINMENT_RECOVERY_ATTEMPT_SCHEMA_V1
CANDIDATE_CONTAINMENT_RECOVERY_ANCHORED_EMPTY_ATTEMPT_SCHEMA_V1
CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECOVERY_TARGET_PROJECTION_SCHEMA_V1
CANDIDATE_CONTAINMENT_LIFETIME_RECOVERY_ATTEMPT_ANCHOR_PROJECTION_SCHEMA_V1
CANDIDATE_CONTAINMENT_LIFETIME_NORMAL_CLOSE_RECEIPT_PROJECTION_SCHEMA_V1
CANDIDATE_CONTAINMENT_RECOVERY_PLAN_SCHEMA_V1
CANDIDATE_CONTAINMENT_RECOVERY_RECORD_SCHEMA_V1
CANDIDATE_CONTAINMENT_RECOVERY_REPLAY_SCHEMA_V1
CANDIDATE_CONTAINMENT_RECOVERY_EXTERNAL_HEAD_SCHEMA_V1
CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SCHEMA_V1
CANDIDATE_CONTAINMENT_RECOVERY_SEQUENCE_STARTS_AT_V1
CANDIDATE_CONTAINMENT_RECOVERY_SEQUENCE_WIDTH_V1
CANDIDATE_CONTAINMENT_RECOVERY_MAX_ATTEMPTS_V1
CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORDS_PER_ATTEMPT_V1
CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORDS_ACROSS_ATTEMPTS_V1
CANDIDATE_CONTAINMENT_RECOVERY_MAX_CONTROL_VALUE_BYTES_V1
CANDIDATE_CONTAINMENT_RECOVERY_MAX_OPERATION_OR_EVIDENCE_BYTES_V1
CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORD_BYTES_V1
CANDIDATE_CONTAINMENT_RECOVERY_MAX_AGGREGATE_RECORD_BYTES_V1
CANDIDATE_CONTAINMENT_RECOVERY_GENESIS_RAW_SHA256_V1
CANDIDATE_CONTAINMENT_RECOVERY_ACTOR_KINDS_V1
CANDIDATE_CONTAINMENT_RECOVERY_REPLAY_ENTRY_KINDS_V1
CANDIDATE_CONTAINMENT_RECOVERY_EXTERNAL_HEAD_RESULTS_V1
CANDIDATE_CONTAINMENT_RECOVERY_ATTEMPT_DIRECTORY_STATES_V1
CANDIDATE_CONTAINMENT_RECOVERY_SOURCE_LOCATIONS_V1
CANDIDATE_CONTAINMENT_RECOVERY_ATTEMPT_SOURCE_LOCATIONS_V1
CANDIDATE_CONTAINMENT_RECOVERY_DISPOSITIONS_V1
CANDIDATE_CONTAINMENT_RECOVERY_QUARANTINE_REASONS_V1
CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1
CANDIDATE_CONTAINMENT_RECOVERY_PLAN_STATUSES_V1
CANDIDATE_CONTAINMENT_RECOVERY_REPLAY_STATUSES_V1
CANDIDATE_CONTAINMENT_RECOVERY_DISPOSITION_SELECTION_PRECEDENCE_V1
CANDIDATE_CONTAINMENT_RECOVERY_UNRESOLVED_EFFECT_INTENT_STATES_V1
CANDIDATE_CONTAINMENT_RECOVERY_AUTHORITY_V1
CANDIDATE_CONTAINMENT_RECOVERY_NONCLAIMS_V1
CANDIDATE_CONTAINMENT_RECOVERY_PHYSICAL_FACTS_V1
CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_V1
CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1
```

The four lifetime-owned projection/head schema identifiers above repeat their
exact literals as read-only recovery contract values; they do not transfer any
brand or permit recovery-v1 to mint one. Recovery-v1 imports from lifetime-v1
only `CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1` and the five
read-only brand assertion functions. At module initialization it requires that
constant to equal the ratified literal
`764975dd915913db4c4e0fc7bee308f8cb830c5f972ac0b97355601e7ff1b773`; a
different lifetime module digest rejects before recovery construction or replay.
It imports no lifetime selector or implementation helper and does not re-export
one.

It also exports exactly these required public functions with their exact
ordered inputs:

```text
deriveCandidateContainmentRecoveryTargetProjectionV1({
  generationManifest, normalJournalBundles
})
createCandidateContainmentRecoveryTargetV1({
  generationManifest, normalJournalBundles,
  lifetimeTargetSelection
})
verifyCandidateContainmentRecoveryTargetV1({
  target, generationManifest, normalJournalBundles,
  lifetimeTargetSelection
})
createCandidateContainmentRecoveryInventoryObservationV1({
  generationIdentitySha256,
  stagingPresent, activePresent, closedPresent,
  recoveredPresent, quarantinedPresent, unsafeEntriesPresent
})
verifyCandidateContainmentRecoveryInventoryObservationV1({
  observation, expectedGenerationIdentitySha256
})
planCandidateContainmentRecoveryV1({
  target, lifecycleInventoryObservation, previousRecoveryReplay,
  normalCloseDurabilityReceipt,
  expectedStateRootIdentitySha256,
  expectedCurrentBootIdSha256,
  expectedDelegatedRootIdentitySha256,
  expectedLifetimeCgroupIdentitySha256,
  proposedActorKind,
  reportedCurrentBootIdSha256,
  reportedStateRootIdentitySha256,
  reportedDelegatedRootIdentitySha256,
  reportedLifetimeCgroupIdentitySha256,
  reportedCommandDescriptorHeld,
  reportedStatusDescriptorHeld,
  reportedSupervisorPidfdHeld,
  reportedDirectChildWaitAuthority,
  reportedCgroupInventorySafe,
  reportedControlCgroupPresent,
  reportedJobCgroupPresent,
  reportedStateFilesystemInterfaceAvailable,
  reportedRecoveryInterfaceAvailable,
  currentLifetimeAnchorProjection,
  currentLifetimeAttemptAnchorRawSha256
})
createCandidateContainmentRecoveryAttemptV1({
  target, lifecycleInventoryObservation, previousRecoveryReplay,
  plan, lifetimeAnchorProjection,
  lifetimeAttemptAnchorRawSha256
})
verifyCandidateContainmentRecoveryAttemptV1({
  attempt, target, lifecycleInventoryObservation, previousRecoveryReplay,
  plan, lifetimeAnchorProjection,
  lifetimeAttemptAnchorRawSha256
})
createCandidateContainmentRecoveryAnchoredEmptyAttemptV1({
  target, previousRecoveryReplay, lifetimeAnchorProjection,
  lifetimeAttemptAnchorRawSha256, reportedAttemptDirectoryState
})
verifyCandidateContainmentRecoveryAnchoredEmptyAttemptV1({
  anchoredEmptyAttempt, target, previousRecoveryReplay,
  lifetimeAnchorProjection,
  lifetimeAttemptAnchorRawSha256
})
createCandidateContainmentRecoveryRecordV1({
  target, lifecycleInventoryObservation, previousRecoveryReplay,
  plan, lifetimeAnchorProjection, lifetimeAttemptAnchorRawSha256,
  attempt, previousRecord, operationBytes, evidenceBytes
})
verifyCandidateContainmentRecoveryRecordV1({name, bytes})
replayCandidateContainmentRecoveryV1({
  target, entries,
  expectedStateRootIdentitySha256,
  expectedExternalHead,
  currentLifetimeAnchorProjection,
  currentLifetimeAttemptAnchorRawSha256,
  currentLifetimeAnchorPredecessorExternalHead,
  normalCloseDurabilityReceipt
})
```

Those 40 values and 13 functions are the complete 53-name required export
inventory for recovery-v1. Implementation-private helpers remain unexported;
harmless standard ESM module metadata that is not an implementation helper or
additional public API is outside this inventory and is not prohibited.

`generationManifest` is the exact verified v2 `{name, bytes}` artifact and
`normalJournalBundles` is a dense ordered array of zero through 18 exact v2
`{name, bytes}` artifacts. Target construction re-verifies the manifest and,
when nonempty, the entire v2/inner-v1 replay itself. The derive function returns
the exact recovery-target projection defined by lifetime-v1. It is a structural,
recursively frozen value without a lifetime boundary brand and cannot be passed
to planning, attempt creation, replay handoff, or physical code. Its only
purpose is to supply the exact canonical operation value for the target-genesis
lifetime record without creating a module cycle.

`lifetimeTargetSelection` is the exact two-field target-selector pair returned
by lifetime-v1: `recoveryTargetProjection` and
`lifetimeTargetRecordRawSha256`. Create and verify require that pair's private
complete-tail replay association and independently derive the projection again
from the supplied manifest and journals. Every projection field, including the
generation-manifest raw hash, generation identity, target SHA-256, target boot,
target delegated root, target lifetime epoch, and four latest-normal-head
fields, must match. A null value, an unbranded
derived projection, a canonical lookalike, a pair from another replay, or a
naked expected-tail hash rejects. Target verification accepts the frozen target
value, not serialized target bytes, and independently reconstructs it from the
same artifacts and paired selection. Inventory verification similarly
reconstructs the digest and checks the expected generation identity. These
values are inputs to later canonical records; they are not standalone durable
artifacts. The recovery target's private metadata retains the exact target
selection solely so recovery-v1 can include it in the lifetime module's atomic
boundary-set assertion; it is never serialized or exposed as authority.
Before any later replay, plan, close, or terminal handoff, the caller re-verifies
the immutable target with a fresh target selection from the same latest
complete-tail-matched lifetime replay used for every other boundary. The
returned target value is byte-for-value equal but carries the new private
association; a target retained from an earlier replay instance fails the atomic
same-origin assertion.

`previousRecoveryReplay` is always an exact output of the replay function,
including its zero-entry result; the planner derives ancestry and any inherited
decision from that value and accepts no caller-provided summary substitute.
Replay's two current-anchor inputs and its current-anchor predecessor-head input
are either all null or all non-null. The predecessor head is the exact branded
head privately associated with that unresolved lifetime anchor; it is distinct
from `expectedExternalHead`, which independently anchors the recovery tail
derived from the supplied entries. Before attempt creation both may be the same
branded predecessor head. For structural replay of records or an anchored-empty
descriptor under an unresolved current anchor, the predecessor head remains
non-null for the atomic same-origin check while `expectedExternalHead` may be
null because the lifetime ledger has not yet published that attempt's result.
When a current anchor exists, a non-null `expectedExternalHead` is permitted only
when it is the exact same object as
`currentLifetimeAnchorPredecessorExternalHead` and the entries still derive that
predecessor head; a byte-equal head selected from another replay rejects. Thus an
unresolved anchor can never smuggle a separately selected post-attempt head.
After the lifetime result is durable the anchor is historical, all three current-
anchor inputs are null, and the result head may be supplied as
`expectedExternalHead`. The normal-close receipt is independently null or the
exact lifetime selector pair. Replay retains these boundary inputs only in
module-private metadata after one atomic lifetime boundary-set assertion; they
do not add serialized or public result fields. A current anchor excludes a
close receipt; a close receipt requires no current anchor. The planner's current-
anchor and close inputs must be the same retained objects from its supplied
replay (including null), so it cannot combine a freshly reverified target with a
replay created against an older lifetime replay or add a later anchor/receipt
after recovery replay.
`RECOVERY_PLAN_READY`, `CLOSE_MOVE_REQUIRED`,
`CLOSED_LOCATION_OBSERVED`, and `RECOVERY_TERMINAL` require that replay to have
`externalTailHeadMatched: true`. A structural replay with no external head is
useful for bounded diagnosis only and cannot authorize creation of a successor
attempt or any physical-plan handoff. A successor's complete lifetime-ledger
anchor may supply this head from its predecessor projection before its attempt
directory exists. A current prelaunch anchor is not itself an anchored-empty
replay entry: only a later exact `ABSENT` or `PRESENT_EMPTY` observation made
before any record-1 temp residue exists creates that descriptor.
The exact recovery-context value embedded in a plan has these ordered fields:

```text
actorKind
reportedCurrentBootIdSha256
reportedStateRootIdentitySha256
reportedDelegatedRootIdentitySha256
reportedLifetimeCgroupIdentitySha256
reportedCommandDescriptorHeld
reportedStatusDescriptorHeld
reportedSupervisorPidfdHeld
reportedDirectChildWaitAuthority
reportedCgroupInventorySafe
reportedControlCgroupPresent
reportedJobCgroupPresent
reportedStateFilesystemInterfaceAvailable
reportedRecoveryInterfaceAvailable
derivedPriorEffectOutcomeCertain
```

The plan result has exactly these ordered fields:

```text
schema
requirementsSha256
status
targetSha256
requiredActorKind
normalTailExternallyAnchored
recoveryTailExternallyAnchored
currentLifetimeAnchorMatched
disposition
quarantineReason
sourceLocation
decisionSourceLocation
requiredDestinationLocation
lifecycleInventorySha256
recoveryContext
inheritedTerminalDecision
latestAttemptState
latestFinalizedRecoveryState
nextPermittedRecordTypes
terminal
states
recordCount
authority
nonclaims
physicalFacts
```

`status` is exactly `RECOVERY_PLAN_READY`, `RECOVERY_ANCHOR_REQUIRED`,
`CLOSE_MOVE_REQUIRED`,
`CLOSED_LOCATION_OBSERVED`, `RECOVERY_TERMINAL`,
`UNSAFE_FILESYSTEM_INVENTORY_BLOCKED`,
`INCONSISTENT_GENERATION_STATE_BLOCKED`,
`RECOVERY_ATTEMPT_LIMIT_REACHED`,
`STATE_ROOT_IDENTITY_REJECTED`,
`STATE_FILESYSTEM_INTERFACE_REJECTED`, or
`RECOVERY_LIFETIME_IDENTITY_REJECTED`. Only
`RECOVERY_PLAN_READY` has non-null disposition and a nonempty exact `states`
array, begins with `RECOVERY_ATTEMPT_DURABLE`, reports that singleton as
`nextPermittedRecordTypes`, and may be consumed to create an attempt. Anchor-
required, blocked, close-move, closed, and terminal outputs have null disposition and quarantine reason,
an empty states/next-permitted array, zero record count, and create no recovery
actor or attempt. `inheritedTerminalDecision` is null, `RECOVERED`, or
`QUARANTINED`; `latestAttemptState` is null or the exact last finalized record
state in the latest attempt. `latestFinalizedRecoveryState` is the last record
state anywhere in the ancestry and remains non-null when a later attempt is
empty. `decisionSourceLocation` is the ready fresh plan's exact `staging` or
`active` source, the immutable first decision source for a resume, terminal, or
blocked descendant, and null before any fresh plan or durable inherited
decision exists. `terminal` is true only after a location-observed recovery terminal or
for the exact already-closed normal case. Destination is `recovered` for
genesis, reboot, same-boot, and recovered-decision resume; `quarantined` for
quarantine and quarantine-decision resume; and `closed` for close-required or
closed-observed. Recovery-terminal reports its already observed `recovered` or
`quarantined` source as destination. Blocked results have null source and
destination even when the adverse inventory happened to contain one candidate;
they do not select it. Every accepted inventory, including a blocked one, keeps
its exact non-null lifecycle-inventory digest in the plan.

After every pre-actor rejection check passes but before a current prelaunch
anchor exists, a would-be attempt returns `RECOVERY_ANCHOR_REQUIRED` with the
one derived `requiredActorKind`, derived `normalTailExternallyAnchored`, true
`recoveryTailExternallyAnchored`, false `currentLifetimeAnchorMatched`, null
disposition, quarantine reason, `sourceLocation`, destination, and recovery
context, the exact `decisionSourceLocation` copied from the previous replay
when an inherited decision exists and null otherwise, the exact lifecycle-
inventory digest, the exact inherited decision and latest-state
fields copied from the previous replay, false terminal, empty states and next-
permitted arrays, zero record count, and the exact authority, nonclaim, and
physical-fact constants. The initialized live-birth guardian writes a live-birth
anchor; the service manager writes a recovery-only anchor. Each contains the
exact target, actor/directory allocation, expected identities, and previous
recovery head, and no other writer may substitute.
Replay consumes that verified anchor's predecessor as the external recovery
head; replanning with the same current anchor returns `RECOVERY_PLAN_READY`
only after every comparison succeeds. Ready has all three anchor booleans true.
It is an authority-null pure plan and is not an actor-adoption claim. A later
live-birth result remains valid only through the anchor's already replayed
normal initialization; a recovery-only actor result remains invalid until
lifetime replay contains its exact launch-intent/pidfd/exec/membership prefix.
The current anchor freezes the observed normal target and recovery predecessor
for successors but does not prove that no valid normal or recovery tail was
deleted before the anchor was written. The corresponding nonclaims remain
false.

`requiredActorKind` is non-null only for anchor-required or ready. Normal-tail
anchoring is true when either a non-null normal head was independently matched,
an already externally anchored recovery lineage freezes the same target, or the
current prelaunch anchor matches that target. Recovery-tail anchoring is true
only when the previous replay's external head matched. Close, closed, and
terminal statuses require both applicable tails anchored but no current attempt
anchor, so `currentLifetimeAnchorMatched` is null for them. Blocked statuses
report each anchor field as false or null according to what was actually
supplied and matched; none is inferred from the status.

After state-root, recovery-lifetime, ledger, and lifecycle-inventory validation
but before state-18, terminal, anchor, or ready selection,
`reportedStateFilesystemInterfaceAvailable: false` returns only
`STATE_FILESYSTEM_INTERFACE_REJECTED`. It has no disposition, source,
destination, states, or recovery context and authorizes no new anchor or actor,
attempt, record, quarantine, close, or generation move.
`currentLifetimeAnchorMatched` still reports the exact false/null/true result
for any supplied current anchor; a previously durable matching anchor is not
erased or reusable. It may later become the anchored-empty entry described
above only after the exact residue-free absent/empty observation; otherwise the
unsafe residue remains blocked or quarantined. Every later nonblocked status
requires the flag true.

`normalCloseDurabilityReceipt` is null outside the state-18 closed-location
check. When non-null it is the exact two-field lifetime close-selector pair
above; its projection and raw record hash must retain the module association to
the same complete-tail-matched replay. A canonical
lookalike, wrong target, partial receipt, or receipt for an active location is
rejected and cannot produce `CLOSED_LOCATION_OBSERVED`.

`recoveryContext` is non-null only for `RECOVERY_PLAN_READY`; its `actorKind` is
the exact actor kind authenticated by the current lifetime anchor and every
other field is the exact normalized reported input except that prior-effect
certainty is replay-derived. It is null for anchor-required and every blocked,
close, closed, or terminal result. `proposedActorKind` is null when no actor was
proposed and may be one exact kind during phase-one planning, but it never
appears as a consumed actor in the result. Phase two reobserves every actor-
specific fact after the lifetime anchor exists. In phase one, where both
current-anchor inputs are null, `proposedActorKind` may be null only for a path
that completes before actor selection (blocked, close, closed, or terminal). A
path that reaches `RECOVERY_ANCHOR_REQUIRED` requires one exact proposed kind;
that kind becomes `requiredActorKind` only if the replay, boot, and actor-lineage
rules admit it, otherwise the input rejects. In phase two, where both current-
anchor inputs are non-null, `proposedActorKind` is exactly null and the consumed
actor kind is derived only from the branded anchor; repeating or overriding it
through the proposal field rejects. Expected and reported recovery-
lifetime identities are equal non-null digests for a ready plan; a proposed
mismatch produces the lifetime-rejected status. This prevents a planning-only
state-18 close, anchor request, or pre-attempt rejection from appearing to
launch an actor or report postlaunch facts; it does not erase an independently
durable phase-one allocation.

A nonterminal previous replay with four attempts returns only
`RECOVERY_ATTEMPT_LIMIT_REACHED`, with no actor, states, or destination; it
cannot be relabeled as a fifth attempt or a terminal decision.

Attempt creation requires a ready plan and an exact independently verified
lifetime-anchor projection whose static fields and predecessor equal the
plan's target, context, and previous replay head. It copies disposition,
source, inventory digest, and reported context from the plan; callers cannot
select or override them. Create and verify reconstruct the plan from the exact
target, observation, previous replay, projection-owned expected identities, and
reported context and require byte-for-value equality with the supplied plan;
they do not trust a caller-forged plan summary. Anchored-empty creation instead consumes only the
prelaunch target, static actor/predecessor anchor, anchor-record raw hash, and
the observed `ABSENT` or `PRESENT_EMPTY` directory state, and verifies that its
predecessor equals the supplied previous replay. It cannot consume a plan or
fabricate postlaunch observations. Record creation re-verifies that same plan,
attempt, anchor, observation, and predecessor context before deriving the one
next record type; callers cannot supply a record type or skip a plan state.

The requirements value has exactly these ordered fields:

```text
schema
targetSchema
inventoryObservationSchema
lifetimeTargetProjectionSchema
lifetimeAnchorProjectionSchema
normalCloseReceiptProjectionSchema
attemptSchema
anchoredEmptyAttemptSchema
planSchema
recordSchema
replayEntryKinds
replaySchema
externalHeadSchema
externalHeadResults
generationManifestSchema
journalBundleSchema
journalV1RequirementsSha256
journalV2RequirementsSha256
lifetimeV1RequirementsSha256
lifetimeBoundaryBrandProtocol
authoritySha256
nonclaimsSha256
physicalFactsSha256
recordFilename
embeddedBytesEncoding
rawHashAlgorithm
semanticHashAlgorithm
bindingHashAlgorithm
sequenceStartsAt
sequenceWidth
maximumAttempts
maximumRecordsPerAttempt
maximumRecordsAcrossAttempts
maximumControlValueBytes
maximumOperationOrEvidenceBytes
maximumRecordBytes
maximumAggregateRecordBytes
genesisRawSha256
actorKinds
attemptDirectoryStates
sourceLocations
attemptSourceLocations
dispositions
quarantineReasons
recordStates
planStatuses
replayStatuses
normalHeadCgroupPresenceMatrix
normalDescriptorMatrix
targetHeadRule
targetProjectionRule
targetUniquenessRule
boundarySetAssertionRule
firstAttemptPredecessorRule
emptyAttemptHeadRule
lifetimeTargetBrandRequired
lifetimeAnchorRequiredPerAttempt
twoPhaseRecoveryPlanning
externalHeadBrandRequired
normalCloseReceiptBrandRequired
externalTailHeadOptional
externalTailHeadRequiredForPlanHandoff
decisionInheritance
decisionSourceRule
dispositionSelectionPrecedence
dispositionRelationshipMatrix
quarantineReasonPrecedence
quarantinePredicateRule
lifecycleInventoryBlockRule
actorLineageRule
descriptorLineageRule
bootLifetimeTransitionRule
bootIdentityRelationshipRule
delegatedRootIdentityRelationshipRule
unresolvedEffectIntentStates
pidfdObservationRule
recoveryPrefixCgroupPresenceRule
selectedInterfaceRule
stateFilesystemGateRule
twoPhaseAnchorRule
state18CloseReceiptRule
generationMoveOrderingRule
operationAndEvidencePayloadShape
operationAndEvidenceSemanticsInterpreted
standaloneRecordHashChainValidated
tailDeletionExcludedByInternalReplay
suppliedAnchorOriginProven
filesystemMechanicsImplemented
filesystemInventoryValidationImplemented
pureLifetimeContractIntegrated
lifetimeLedgerFilesystemMechanicsImplemented
recoveryMutationImplemented
guardianImplemented
supervisorExecutionProven
applicationReceiptPermitted
runtimeRegistrationPermitted
qualificationPermitted
promotionPermitted
publicationPermitted
```

The requirements hash is a literal evaluator-owned golden value once the
ratified red suite lands; production code computes and exports the same value
from the exact projection rather than importing test data.

The schema fields use the literal schema strings ratified in this section;
`generationManifestSchema` and `journalBundleSchema` are the two v2 literals
above. `journalV1RequirementsSha256` is
`e76b54712178631c51eb90a8c46ce0bae29b9a0d66b25ada937566d65cf91bb4` and
`journalV2RequirementsSha256` is
`95a4311224d8dfa5f481436e87da4b4d5f56a00d67278e7ed0e931476b584e26`.
`lifetimeV1RequirementsSha256` is the non-null lowercase evaluator-owned golden
digest ratified by the preceding lifetime-v1 red suite; recovery-v1 cannot
ratify its own golden digest, return ready, or accept a branded lifetime value
until this literal dependency is fixed. A lifetime verifier with a different
requirements digest is rejected even when its projection schema strings are
unchanged.
`lifetimeBoundaryBrandProtocol` is exactly
`complete-tail-matched-lifetime-replay-weakmap-pair-brand/v1`: the lifetime
module owns private `WeakMap` associations from each selected target, anchor,
external-head, or close boundary to its exact record raw hash when applicable
and its originating replay, so values from two separately valid records or
replays cannot be mixed.
The three boundary hashes are canonical semantic SHA-256 values of the exact
authority, nonclaim, and physical-fact records below. Filename is
`<16-digit-sequence>-<record-raw-sha256>.jsonl`; encoding is
`rfc4648-canonical-padded-base64`; raw, semantic, and binding algorithms are
respectively `sha256-canonical-jsonl-with-final-lf/v1`,
`sha256-canonical-json-without-final-lf/v1`, and
`sha256-canonical-binding-json-without-final-lf/v1`.

Numeric values are exactly `1`, `16`, `4`, `24`, `96`, `16384`, `16384`,
`65536`, and `6291456` in the ordered numeric fields above, and genesis is 64
ASCII zeroes. Ordered arrays are exactly: actor kinds
`[LIVE_BIRTH_GUARDIAN, RECOVERY_ONLY_GUARDIAN]`; entry kinds
`[ANCHORED_EMPTY_ATTEMPT, FINALIZED_ATTEMPT]`; external-head results
`[NO_RECOVERY_ATTEMPT, ANCHORED_EMPTY_ATTEMPT, FINALIZED_ATTEMPT_PREFIX,
RECOVERED, QUARANTINED]`; directory states
`[ABSENT, PRESENT_EMPTY]`; lifecycle source locations
`[staging, active, closed, recovered, quarantined]`; attempt source locations
`[staging, active, recovered, quarantined]`; dispositions and quarantine
reasons in their declared/table order; record states in the vocabulary order
below; and plan/replay statuses in the order declared above.

The exact rule strings are:

```text
normalHeadCgroupPresenceMatrix = null:00;1:00;2:00|10|01|11;3-14:11;15:00|10|01|11;16-18:00
normalDescriptorMatrix = null|1-3:0000;4:command-any,status-any,unreaped-pidfd-wait-00|11,reaped-pidfd-wait-00|10;5-12:command-any,status-any,unreaped-pidfd-wait-11,reaped-pidfd-wait-00|10;13-16:command-any,status-any,pidfd-wait-00|10;17-18:0000;recovery-only:0000/v1
targetHeadRule = all-four-null-genesis-or-all-four-verified-v2-head/v1
targetProjectionRule = derive-unbranded-from-reverified-manifest-and-complete-journal;create-or-verify-target-requires-exact-complete-tail-lifetime-selector-pair;all-projection-fields-match/v1
targetUniquenessRule = lifetime-replay-enforces-one-target-per-generation-identity-and-no-target-sha-reuse-across-identities/v1
boundarySetAssertionRule = target-required;historical-anchor-carriers-dense-ledger-order-and-brand-nested-projection-plus-raw;optional-current-carrier-head-close;same-originating-replay-instance;current-anchor-predecessor-equals-external-head;byte-equal-cross-replay-rejects/v1
firstAttemptPredecessorRule = null-actor-null-directory-null-sequence-zero-raw/v1
emptyAttemptHeadRule = nonnull-actor-nonnull-directory-null-sequence-zero-raw/v1
decisionInheritance = first-terminal-decision-is-transitive-and-irreversible/v1
decisionSourceRule = fresh-plan:decision-source-equals-singleton-staging-or-active;first-durable-decision-freezes-source;resume-current-location-is-exactly-decision-source-or-matching-destination;destination-only-syncs-and-reobserves-decision-source-parent-plus-destination/v1
actorLineageRule = live-birth-only-on-target-boot-before-any-recovery-only-or-reboot;proved-boot-boundary-always-recovery-only;recovery-only-never-live-birth/v1
descriptorLineageRule = consecutive-live-birth-held-booleans-only-true-to-false;command-close-clears-command;reap-clears-wait;recovery-only-or-reboot-clears-all/v1
bootLifetimeTransitionRule = same-boot-repeats-current-identities;each-proved-reboot-consumes-distinct-recovery-lifetime;later-entries-repeat-that-boots-identities/v1
bootIdentityRelationshipRule = same-boot-effect-branch:report-equals-current-and-target;proved-reboot-or-required-resume:report-equals-current;quarantine-or-quarantine-resume:exact-adverse-relation-validated/v1
delegatedRootIdentityRelationshipRule = same-boot-effect-branch:report-and-current-equal-target;proved-reboot-or-required-resume:report-equals-current;quarantine-or-quarantine-resume:exact-null-mismatch-or-current-relation-validated/v1
pidfdObservationRule = reap-proven-from-normal-state13plus-or-recovery-reaped;held-and-not-reap-proven:readable-and-wait-required;held-and-reap-proven:hup-and-no-wait;not-held:none;held-no-wait-without-reap-proof:inconsistent/v1
recoveryPrefixCgroupPresenceRule = before-removal-intent:normal-matrix-no-reappearance;after-removal-intent:present-to-absent-only;after-paths-absent:00/v1
selectedInterfaceRule = recovery-interface-means-selected-nonfilesystem-descriptor-pidfd-wait-or-delegated-cgroup-interface;filesystem-only-resume-may-report-false/v1
stateFilesystemGateRule = false-before-state18-terminal-anchor-or-ready:no-new-anchor-or-actor-launch-or-attempt-record-quarantine-close-or-generation-move;supplied-durable-anchor-preserved;after-restore-exact-pre-temp-absent-or-empty-finalizes-anchored-empty;temp-or-other-residue-remains-unsafe/v1
twoPhaseAnchorRule = phase1-anchor-required-with-no-context;durable-lifetime-prelaunch-anchor;phase2-reobserve-and-match-before-ready;anchor-without-record1-finalizes-anchored-empty-only-from-exact-residue-free-absent-or-empty-pre-temp-observation;temp-or-other-residue-blocks-or-quarantines;actor-never-reused/v1
state18CloseReceiptRule = active-or-unreceipted-closed:close-move-required;receipt-branded-exact-target-dual-parent-sync-and-reobserve:closed-location-observed/v1
generationMoveOrderingRule = decision-or-adoption-durable;rename-noreplace-from-immutable-decision-source-or-destination-only;sync-decision-source-and-destination-parents;reobserve-decision-source-absence-and-destination-identity;location-record-durable/v1
operationAndEvidencePayloadShape = opaque-bounded-canonical-json
```

`dispositionSelectionPrecedence` is exactly
`[PRE_ACTOR_REJECTION, STATE_FILESYSTEM_INTERFACE_REJECTION, NORMAL_STATE_18,
RECOVERY_LOCATION_TERMINAL, ATTEMPT_LIMIT, INHERITED_RECOVERED_DECISION,
INHERITED_QUARANTINE_DECISION, FRESH_DISPOSITION]`.
`quarantineReasonPrecedence` is exactly the declared quarantine-reason array.
`dispositionRelationshipMatrix` is exactly
`GENESIS_ABORT=source:staging|active,decision-source:source,head:null,boot:target,cgroup:00;
SAME_BOOT_RECONCILE=source:active,decision-source:source,head:1-17,boot:target,root:target-and-current,
cgroup:normal-matrix; REBOOT_INTERRUPTION=source-head-pairs:[(staging,null),(active,null),(active,1-17)],decision-source:source,
boot:different-proved,actor:recovery-only,cgroup:00,
descriptors:0000; QUARANTINE=source:staging|active,target-and-predecessor:valid,
decision-source:source,state-root-and-lifetime:exact,inherited:none,predicate:first-true;
RECOVERED_DECISION_RESUME=inherited:recovered,terminal-location:false,
decision-source:ancestor,current-source:decision-source|recovered,cgroup:00; QUARANTINE_DECISION_RESUME=
inherited:quarantined,terminal-location:false,decision-source:ancestor,current-source:decision-source|quarantined,
delegated-effects:none/v1` with ASCII spaces and newlines removed before it is
stored in the requirements value.
`quarantinePredicateRule` is exactly
`boot-null-or-applicable-current-mismatch>delegated-null-or-applicable-current-mismatch-or-same-boot-target-drift>unsafe-cgroup-inventory>disposition-presence-or-descriptor-mismatch>selected-nonfilesystem-interface-unavailable>prior-effect-uncertain/v1`.
`lifecycleInventoryBlockRule` is exactly
`malformed-or-corrupt:reject-before-plan;zero-or-multiple-or-unsafe-entry:unsafe-filesystem-inventory-blocked;one-safe-source-required-before-durable-quarantine/v1`.
`unresolvedEffectIntentStates` is exactly
`[COMMAND_DESCRIPTOR_CLOSE_INTENT_DURABLE, CONTROL_KILL_INTENT_DURABLE,
JOB_FIRST_KILL_INTENT_DURABLE, JOB_SECOND_KILL_INTENT_DURABLE,
SUPERVISOR_REAP_INTENT_DURABLE, CGROUP_REMOVAL_INTENT_DURABLE]`.

`lifetimeTargetBrandRequired`, `lifetimeAnchorRequiredPerAttempt`, `twoPhaseRecoveryPlanning`,
`externalHeadBrandRequired`, and `normalCloseReceiptBrandRequired` are true;
`externalTailHeadOptional` is true and
`externalTailHeadRequiredForPlanHandoff` is true: replay may be structural, but
a ready/close/terminal handoff requires the match. The two standalone/internal nonclaim fields
are false. `operationAndEvidenceSemanticsInterpreted`,
`standaloneRecordHashChainValidated`,
`tailDeletionExcludedByInternalReplay`, `suppliedAnchorOriginProven`,
`filesystemMechanicsImplemented`, `filesystemInventoryValidationImplemented`,
`lifetimeLedgerFilesystemMechanicsImplemented`, `recoveryMutationImplemented`,
`guardianImplemented`, `supervisorExecutionProven`, and every application,
registration, qualification, promotion, and publication field are false.
`pureLifetimeContractIntegrated` alone is true because recovery-v1 imports the
preceding pure module and validates its exact requirements digest and paired
brands. Arrays and boundary records are recursively frozen null-prototype
values and their order participates in the requirements hash.

#### Recovery record, replay, and external anchor

Every finalized record has exactly `schema`, `sequence`, `recordType`,
`priorState`, `nextState`, `previousRecordRawSha256`, `targetSha256`, `attempt`,
`operation`, and `evidence`. It embeds the full unchanged attempt object;
`recordType` equals `nextState`; and the first finalized record is always
`RECOVERY_ATTEMPT_DURABLE`, with sequence `0000000000000001`, null prior state,
and the all-zero in-attempt predecessor. That record is the attempt manifest;
there is no second manifest file. Later records follow only the exact plan and
raw predecessor for that attempt.

`previousRecord` is exactly null for sequence 1. For every later sequence it is
either the immediately preceding returned record wrapper or an exact
`{name, bytes}` reference that is independently decoded and verified; no other
summary or raw hash is accepted. Its target, attempt, sequence, state, name, and
raw hash must be the one predecessor required by the re-derived plan. The
create function still reports standalone chain/plan validation false on the new
wrapper; only replay of the complete supplied prefix upgrades those facts.

Operation and evidence descriptors have exactly `schema`, `rawSha256`,
`semanticSha256`, `bytesBase64`, and `bindingSha256`. Their schema is the exact
state-specific
`oxigraph.candidate-containment-recovery-{operation|evidence}/<lower-kebab-record-type>/v1`.
The record-type component is formed only by ASCII-lowercasing and replacing
each underscore with one hyphen; no locale, normalization, or caller name is
consulted.
Raw SHA-256 covers the canonical single-LF JSONL bytes and semantic SHA-256
covers the canonical JSON value without that LF. The binding SHA-256 covers the canonical projection
with exactly these ordered fields:

```text
schema
kind
artifactSchema
sequence
recordType
priorState
targetSha256
attemptSha256
recoveryActorEpochSha256
previousRecordRawSha256
rawSha256
semanticSha256
```

`schema` is
`oxigraph.candidate-containment-recovery-{operation|evidence}-binding/v1`,
`kind` is exactly `operation` or `evidence`, and `artifactSchema` is the
state-specific descriptor schema. `rawSha256` and `semanticSha256` are the
payload digests. The projection excludes `bytesBase64`, `bindingSha256`, and
the complete target or attempt value, so it is neither circular nor
size-ambiguous.
Payload values remain opaque bounded canonical JSON: the descriptor proves
byte/context equality, not an operation, observation, origin, or physical
effect.

The sole state-specific payload interpretation is structural, not physical:
record 1 `RECOVERY_ATTEMPT_DURABLE` evidence bytes must be the exact canonical
lifecycle-inventory observation value. Its verified `inventorySha256` equals
the attempt's `reportedLifecycleInventorySha256`, while the evidence descriptor
separately binds the semantic SHA-256 of the complete observation. Replay
derives the historical observation from those persisted evidence bytes and never asks a caller to
recreate it after a move. This proves only what the record reported; it does
not prove the observation's origin, completeness, or relationship to a real
filesystem.

Replay accepts at most four exact tagged entries. An
`ANCHORED_EMPTY_ATTEMPT` entry has exactly `kind`, `lifetimeAnchorProjection`,
`lifetimeAttemptAnchorRawSha256`, `anchoredEmptyAttempt`, and `records`; records
is exactly empty. A `FINALIZED_ATTEMPT` entry has exactly `kind`,
`lifetimeAnchorProjection`, `lifetimeAttemptAnchorRawSha256`, `attempt`, and
`records`; records contains 1 through 24 exact `{name, bytes}` artifacts and
record 1 embeds that attempt and its lifecycle observation. The production
consumer must obtain every projection and raw anchor from complete
lifetime-ledger replay anchored to the expected state root and lifetime. This
pure recovery module can enforce only exact structure, per-field/raw-hash
equality, and predecessor relationships; it therefore accepts only paired
selector outputs branded by complete-tail-matched lifetime replay. It never
treats standalone projection bytes, a canonical lookalike, or a digest-shaped
string as authentication. Integration proves no physical origin or durability,
so the corresponding nonclaims remain false permanently.

Before accepting the entry array, expected external head, a phase-two current
anchor, or a normal-close receipt, recovery-v1 calls the lifetime module's
composite boundary-set assertion with the target's retained selection, every
historical anchor selection in ledger order, the optional current selection,
the current anchor's separately supplied predecessor head when current is
non-null (otherwise the optional expected external head), and the optional close
boundary. It independently compares `expectedExternalHead`, when non-null, with
the head derived from the recovery entries. Thus individually valid values from
two complete replay instances reject, a current anchor cannot be paired with a
predecessor other than its private association, and that predecessor cannot be
misrepresented as an externally published post-attempt result.

Every projection's expected state-root identity equals the replay input's one
global state-root anchor. Current boot, delegated-root, and recovery-lifetime
identities are verified per entry against that entry's lifetime-ledger
projection; replay does not compare all attempts to one global lifetime-cgroup
input. Within one boot, all attempts use the same ledger-bound lifetime and
delegated-root identities. Across adjacent attempts on the same boot, both
identities exactly repeat. Across a lifetime-ledger-proved different boot, the
recovery-lifetime identity must change, the delegated-root identity may change,
and the actor is recovery-only; later attempts on that boot repeat all current
identities. The transition is valid for a prelaunch or anchored-empty actor
before disposition exists. Once finalized, an actor on a changed boot must use
`REBOOT_INTERRUPTION` unless an inherited recovered/quarantine decision instead
forces its matching resume disposition. A delegated-root identity may differ
from the target's historical binding only on such a proved different boot.
Every prelaunch anchor, anchored-empty entry, and finalized entry crossing a
proved boot boundary has `RECOVERY_ONLY_GUARDIAN`; a live-birth actor is valid
only while its expected current boot equals the target boot and no earlier
recovery-only or reboot entry exists.

The optional external head is null or has exactly `schema`, `targetSha256`,
`result`, `recoveryActorEpochSha256`, `attemptDirectoryName`,
`lifetimeAttemptAnchorRawSha256`, `latestRecoveryRecordSequence`,
`latestRecoveryRecordRawSha256`, and `externalHeadSha256`; the final digest is
the canonical semantic SHA-256 of every preceding field. `result`
is exactly `NO_RECOVERY_ATTEMPT`, `ANCHORED_EMPTY_ATTEMPT`,
`FINALIZED_ATTEMPT_PREFIX`, `RECOVERED`, or `QUARANTINED`. The no-attempt head
has null actor, directory, lifetime-anchor hash, and sequence plus an all-zero raw head; an
anchored-empty head has a non-null actor, directory, and lifetime-anchor raw
hash, null sequence, and an all-zero raw head; every finalized head has a
non-null lifetime-anchor raw hash plus a non-null actor and directory,
16-digit sequence, and raw hash. It is supplied only from a complete
lifetime-ledger replay of either a generation/recovery-lineage genesis receipt,
a current or successor prelaunch anchor's predecessor projection, or a
post-attempt result/head projection. A verified
successor's prelaunch anchor separately authenticates its predecessor head.
The prelaunch anchor for the latest actor never authenticates that actor's new
zero or nonzero final head.

At the integrated boundary, `expectedExternalHead`, every entry anchor, and the
current prelaunch anchor are module-branded, copy-on-read outputs of complete
`containment-guardian-lifetime-v1` replay. Recovery-v1 cannot be promoted as a
completed contract ahead of that verifier: its red suite must compose with the
evaluator-owned lifetime-v1 outputs rather than constructing lookalike anchor
objects. Structural anchor fixtures may exercise recovery parsing while both
modules are red, but they keep matching fields false/null and cannot reach a
ready plan. This ordering makes the pure lifetime ledger the implementation
prerequisite for ready recovery planning.
For phase two, the current anchor pair and predecessor external head must come
from selectors over the same exact lifetime replay; the anchor's module-private
predecessor association must equal that external head. Mixing two valid replay
instances, projections, or record hashes rejects.

The external result is derived, never caller-selected: zero entries map to
`NO_RECOVERY_ATTEMPT`, an empty tail to `ANCHORED_EMPTY_ATTEMPT`, a nonterminal
record tail to `FINALIZED_ATTEMPT_PREFIX`, and the two terminal location states
to `RECOVERED` or `QUARANTINED`. Any result/head mismatch rejects replay.

Replay rejects actor, directory, or anchor reuse, target drift, lifetime or
attempt predecessor drift, gaps, reordering, multiple successors, plan
surplus, and any internal raw-chain mismatch. A non-zero
`lifetimeAttemptAnchorRawSha256` alone is never accepted as authentication.

Internal replay cannot distinguish deletion of an unanchored valid tail from an
honest crash prefix. Tail deletion is rejected only when a verified successor or
the independently durable post-attempt lifetime result supplies the exact
latest actor, attempt directory, sequence/null, and raw head. When no external
head is supplied, structural crash-prefix replay remains valid but reports
`externalTailHeadMatched: null` and
`tailCompletenessExternallyAnchored: false`. When one is supplied and equal,
those fields are true; inequality rejects replay. Equality proves only equality
to the verified lifetime output consumed at the boundary, not origin,
durability, completeness of some other ledger, freshness, filesystem
inventory, or authority. Replay always keeps
`tailDeletionExcludedByInternalReplay: false` and
`suppliedAnchorOriginProven: false`, leaves filesystem and physical facts null,
and grants no mutation, execution, recovery, application, qualification,
promotion, or publication authority.

The replay result has exactly these ordered fields:

```text
schema
requirementsSha256
status
targetSha256
attemptCount
finalizedAttemptCount
anchoredEmptyAttemptCount
recordCount
latestRecoveryActorEpochSha256
latestAttemptDirectoryName
latestRecoveryRecordSequence
latestRecoveryRecordRawSha256
latestAttemptState
latestFinalizedRecoveryState
derivedPriorEffectOutcomeCertain
latestExpectedCurrentBootIdSha256
latestExpectedDelegatedRootIdentitySha256
latestExpectedLifetimeCgroupIdentitySha256
liveBirthActorStillPermitted
commandDescriptorMayRemainHeld
statusDescriptorMayRemainHeld
supervisorPidfdMayRemainHeld
directChildWaitAuthorityMayRemain
nextRequiredState
inheritedTerminalDecision
decisionSourceLocation
internalHashChainValidated
targetBindingsMatched
lifetimeAnchorBindingsMatched
lifecycleInventoryBindingsMatched
recordPlanBindingsMatched
externalTailHeadMatched
tailCompletenessExternallyAnchored
stateRootIdentityAnchorMatched
bootIdentityRelationshipsValidated
delegatedRootIdentityRelationshipsValidated
lifetimeCgroupIdentityAnchorsMatched
tailDeletionExcludedByInternalReplay
suppliedAnchorOriginProven
chainTerminal
authority
nonclaims
physicalFacts
```

`status` is exactly `NO_RECOVERY_ATTEMPT`,
`VALID_RECOVERY_PREFIX_REPLAYED`,
`VALID_ANCHORED_EMPTY_ATTEMPT_REPLAYED`,
`COMPLETE_RECOVERED_REPLAYED`, or
`COMPLETE_QUARANTINED_REPLAYED`. Zero entries yield the no-attempt status and
genesis head. A latest anchored-empty entry has null latest-attempt state and
next state, preserves the latest finalized ancestral state separately, and
retains any decision inherited from its complete ancestry. A nonempty prefix
reports its exact latest and next state. Only the two location-observed states
are terminal. The output's latest head is derived solely from accepted entries;
external-head equality is reported separately. Zero-entry replay reports
`internalHashChainValidated: true` and `targetBindingsMatched: true`; lifetime,
inventory, record-plan, state-root, boot, delegated-root, and lifetime-cgroup binding
fields are null because no entry exists. An all-empty nonzero replay reports
lifetime/state/boot/delegated/lifetime-cgroup binding fields true but inventory and
record-plan fields null. Once a finalized attempt exists, every binding field
is true. External-tail matching remains independently null or true for all
three cases; mismatch rejects instead of returning false.

`decisionSourceLocation` starts null. The first verified
`RECOVERED_TOMBSTONE_DURABLE` or `QUARANTINE_INTENT_DURABLE` sets it to that
attempt's exact planned source, which is `staging` or `active`; every later
empty or finalized attempt preserves it. A different source rejects replay.
The value is not inferred from the currently observed destination and never
changes after a move.

Replay initializes `derivedPriorEffectOutcomeCertain` true. Empty attempts
preserve it. A finalized attempt whose last record is one of the unmatched
effect intents enumerated below changes it to false; a later attempt manifest
or caller observation cannot reset it. The attempt embedded in every later
record must repeat the value derived from its predecessor replay. A durable
recovered or quarantine decision does not claim that the prior effect became
certain; decision inheritance simply takes precedence and permits only its
move-resume graph.

The three latest-expected identity fields are null for zero entries and
otherwise repeat the latest lifetime-anchor projection, including across an
empty tail. `liveBirthActorStillPermitted` starts true and becomes permanently
false after the first recovery-only actor or proved reboot. A later live-birth
actor is rejected. Across consecutive live-birth attempts on one guardian,
each reported command/status/pidfd/wait boolean may stay equal or change only
from true to false; false-to-true reconstruction is rejected. A verified
command-closed observation permanently clears the command ceiling, and a
verified reap observation permanently clears the direct-wait ceiling. A
recovery-only or reboot actor clears all four ceilings. Empty live-birth
attempts preserve existing ceilings; empty recovery-only attempts clear them.
The planner intersects these ancestral ceilings with the exact normal-state
descriptor table before it can return ready.

For zero entries the descriptor ceilings are derived exactly from the target's
normal head: null/state 1 through 3 initializes all four false; states 4 through
12 initializes command/status/pidfd/direct-wait true; states 13 through 16
initializes command/status/pidfd true and direct-wait false; and states 17 or 18
initializes all four false. These are permissive ceilings, not reported held
facts or physical claims. Each accepted attempt then applies the monotone rules
above.

`RECOVERY_TERMINAL` planning requires the replay's terminal decision and
location-observed state to match the exact singleton `recovered` or
`quarantined` lifecycle observation. A terminal replay with any other location
or collision is an inconsistent/unsafe blocked result, never a terminal
clearance.

Plan and replay embed the same frozen authority value with exactly these keys,
all false and in this order:

```text
mayPersistLifetimeAnchor
mayConsumeRecoveryActorEpoch
mayAppendLifetimeLedger
mayCreateAttemptDirectory
mayPersistRecoveryRecord
mayBlockAdmission
mayMutateStateFilesystem
mayMoveGeneration
mayQuarantineGeneration
mayMutateDelegatedCgroup
mayWriteCgroupKill
mayRemoveCgroupPath
maySignalPersistedPid
mayCloseUnheldDescriptor
mayCloseCommandDescriptor
mayReadStatusDescriptor
mayUseSupervisorPidfd
mayReapSupervisor
mayWriteSupervisorCommand
mayExecuteRecoveryPlan
mayAcceptApplicationResult
mayIssueApplicationReceipt
mayRegisterRuntime
mayQualify
mayPromote
mayPublish
productionContainment
```

They embed the same frozen nonclaim value with exactly these keys, all false
and in this order:

```text
serializedTargetProvesManifestOrigin
serializedAttemptProvesActorOrigin
serializedReplayProvesFreshness
serializedReplayProvesFreshRandomness
serializedReplayProvesExclusiveStateRootLock
serializedReplayProvesCompleteFilesystemInventory
serializedReplayProvesStateFilesystemMetadata
serializedReplayProvesFilesystemDurability
serializedReplayProvesLifetimeAnchorOrigin
serializedReplayProvesLifetimeAnchorDurability
serializedReplayProvesGuardianExecution
serializedReplayProvesGuardianLiveness
serializedReplayProvesGuardianParentage
serializedActorDigestProvesProcessContinuity
reportedBootDigestComparisonProvesBootIdentity
serializedReplayProvesStateRootIdentity
serializedReplayProvesDelegatedRootIdentity
serializedReplayProvesLifetimeCgroupIdentity
serializedReplayProvesSupervisorExecution
serializedReplayProvesDescriptorOwnership
serializedReplayProvesPidfdOwnership
serializedReplayProvesDirectChildReap
serializedReplayProvesSupervisorExitStatus
serializedReplayProvesCgroupKillEffect
serializedReplayProvesCgroupQuiescence
serializedReplayProvesCgroupRemoval
serializedReplayProvesDescriptorClosure
serializedReplayProvesGenerationMove
serializedReplayProvesGenerationLocation
serializedReplayProvesApplicationResult
serializedReplayGrantsRecoveryMutationAuthority
completeRecoveryReplayProvesOperationalRecoveryClearance
operationArtifactProvesEffect
evidenceArtifactProvesObservation
embeddedRecoveryRecordProvesTrustedOrigin
canonicalBase64ProvesPersistence
suppliedAnchorOriginProven
suppliedLifecycleInventoryProvesCompleteness
tailDeletionExcludedByInternalReplay
plannerBlockedStatusEnforcesAdmissionBlock
```

They embed the same frozen physical-fact value with these exact ordered keys
and values:

```text
stateRootIdentityObserved: null
stateFilesystemInterfaceAvailable: null
generationManifestPersisted: null
normalJournalFilesystemDurability: null
lifetimeAnchorPersisted: null
attemptDirectoryPersisted: null
recoveryRecordFilesystemDurability: null
filesystemInventoryValidated: null
generationSourceLocationObserved: null
guardianExecuted: null
currentBootIdentityObserved: null
delegatedRootIdentityObserved: null
lifetimeCgroupIdentityObserved: null
recoveryActorLive: null
commandDescriptorHeld: null
commandDescriptorClosed: null
statusDescriptorHeld: null
statusEofObserved: null
supervisorPidfdHeld: null
supervisorPidfdReadable: null
supervisorPidfdHup: null
directChildWaitAuthority: null
supervisorReaped: null
supervisorExitStatus: null
controlCgroupPresent: null
jobCgroupPresent: null
controlKillWriteCompleted: null
jobFirstKillWriteCompleted: null
jobSecondKillWriteCompleted: null
controlQuiescent: null
jobQuiescent: null
cgroupPathsAbsent: null
recoveredTombstonePersisted: null
quarantineIntentPersisted: null
generationMoved: null
recoveredLocationObserved: null
quarantinedLocationObserved: null
applicationResult: null
physicalRecoveryRequired: null
cleanupSafe: null
binding: null
physicalEligibility: false
finalDecisionEligibility: false
productionContainment: false
```

Target, inventory, attempt, anchored-empty, and record values do not carry
authority, nonclaims, or physical facts. Their absence is not an authority
grant: only plan/replay are trust-boundary summaries, and both always carry the
exact constants above.

#### Finite recovery plans

The ordered recovery record-state vocabulary is exactly:

```text
RECOVERY_ATTEMPT_DURABLE
GENESIS_ABORT_RECOVERY_REQUIRED
REBOOT_INTERRUPTION_OBSERVED
COMMAND_DESCRIPTOR_CLOSE_INTENT_DURABLE
COMMAND_DESCRIPTOR_CLOSED_OBSERVED
CONTROL_PATH_ABSENT_OBSERVED
CONTROL_KILL_INTENT_DURABLE
CONTROL_KILL_WRITE_COMPLETED
JOB_PATH_ABSENT_OBSERVED
JOB_FIRST_KILL_INTENT_DURABLE
JOB_FIRST_KILL_WRITE_COMPLETED
CONTROL_QUIESCENT_OBSERVED
JOB_SECOND_KILL_INTENT_DURABLE
JOB_SECOND_KILL_WRITE_COMPLETED
JOB_QUIESCENT_OBSERVED
STATUS_EOF_OBSERVED
SUPERVISOR_PIDFD_READABLE_OBSERVED
SUPERVISOR_PIDFD_HUP_OBSERVED
SUPERVISOR_REAP_INTENT_DURABLE
SUPERVISOR_REAPED_OBSERVED
CGROUP_REMOVAL_INTENT_DURABLE
CGROUP_PATHS_ABSENT_OBSERVED
RECOVERED_TOMBSTONE_DURABLE
RECOVERED_TOMBSTONE_ADOPTED
RECOVERED_LOCATION_OBSERVED
QUARANTINE_INTENT_DURABLE
QUARANTINE_INTENT_ADOPTED
QUARANTINED_LOCATION_OBSERVED
```

The exact genesis, reboot, and quarantine plans are:

```text
RECOVERY_ATTEMPT_DURABLE
→ GENESIS_ABORT_RECOVERY_REQUIRED
→ CGROUP_PATHS_ABSENT_OBSERVED
→ RECOVERED_TOMBSTONE_DURABLE
→ RECOVERED_LOCATION_OBSERVED

RECOVERY_ATTEMPT_DURABLE
→ REBOOT_INTERRUPTION_OBSERVED
→ CGROUP_PATHS_ABSENT_OBSERVED
→ RECOVERED_TOMBSTONE_DURABLE
→ RECOVERED_LOCATION_OBSERVED

RECOVERY_ATTEMPT_DURABLE
→ QUARANTINE_INTENT_DURABLE
→ QUARANTINED_LOCATION_OBSERVED
```

The quarantine record plan requires a verified state root, immutable target,
recovery predecessor, and one unique source location. Pre-attempt state-root,
ledger, or filesystem-inventory rejection never enters this graph and cannot be
relabeled as a durable quarantine move.

The same-boot plan is exactly:

```text
RECOVERY_ATTEMPT_DURABLE
→ [COMMAND_DESCRIPTOR_CLOSE_INTENT_DURABLE
   → COMMAND_DESCRIPTOR_CLOSED_OBSERVED]
→ (CONTROL_PATH_ABSENT_OBSERVED
   | CONTROL_KILL_INTENT_DURABLE
     → CONTROL_KILL_WRITE_COMPLETED)
→ (JOB_PATH_ABSENT_OBSERVED
   | JOB_FIRST_KILL_INTENT_DURABLE
     → JOB_FIRST_KILL_WRITE_COMPLETED)
→ [CONTROL_QUIESCENT_OBSERVED]
→ [JOB_SECOND_KILL_INTENT_DURABLE
   → JOB_SECOND_KILL_WRITE_COMPLETED
   → JOB_QUIESCENT_OBSERVED]
→ [STATUS_EOF_OBSERVED]
→ [SUPERVISOR_PIDFD_READABLE_OBSERVED
   | SUPERVISOR_PIDFD_HUP_OBSERVED]
→ [SUPERVISOR_REAP_INTENT_DURABLE
   → SUPERVISOR_REAPED_OBSERVED]
→ [CGROUP_REMOVAL_INTENT_DURABLE]
→ CGROUP_PATHS_ABSENT_OBSERVED
→ RECOVERED_TOMBSTONE_DURABLE
→ RECOVERED_LOCATION_OBSERVED
```

Disposition selection is ordered and the first matching row is final. A
pre-actor state-root, recovery-lifetime, ledger, or lifecycle-inventory
rejection wins first. State-filesystem-interface rejection wins next and
authorizes no persisted quarantine. A verified state-18 normal head follows and
is handled only by the normal-close table below. An already location-terminal recovery
follows. A nonterminal replay with four attempts returns the attempt-limit
status next, even when it has an inherited decision. A verified inherited
recovered or quarantine decision then wins and can only resume that decision. Only then may
a fresh null/state-1-through-17 head select `GENESIS_ABORT`,
`SAME_BOOT_RECONCILE`, `REBOOT_INTERRUPTION`, or `QUARANTINE`. A later boot
never reverses or replaces a durable normal-close or recovery decision.

The exact disposition relationship is:

| Disposition                  | Exact relationship                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GENESIS_ABORT`              | singleton `staging` or `active`; null normal head; current boot equals target boot; safe cgroup inventory; control/job both false                                                                                                                                                                                                                |
| `SAME_BOOT_RECONCILE`        | singleton `active`; normal state 1 through 17; current boot equals target boot; current delegated root equals target and lifetime projection; cgroup presence is allowed by the table below                                                                                                                                                      |
| `REBOOT_INTERRUPTION`        | singleton `staging` with null head, or `active` with null/state 1 through 17; current boot differs from target; recovery-only actor; current root/lifetime identities equal its projection; control/job both false; no descriptor or delegated-root mutation                                                                                     |
| `QUARANTINE`                 | singleton `staging` or `active`; valid target and predecessor; exact state root and recovery lifetime; no inherited terminal decision; the first post-inventory quarantine predicate below is true                                                                                                                                               |
| `RECOVERED_DECISION_RESUME`  | inherited recovered tombstone but no recovered-location terminal; immutable decision source is `staging` or `active`; current observed source is exactly that same decision source or `recovered`, never the other pre-move location or `quarantined`; safe control/job inventory both false                                                     |
| `QUARANTINE_DECISION_RESUME` | inherited quarantine intent but no quarantined-location terminal; immutable decision source is `staging` or `active`; current observed source is exactly that same decision source or `quarantined`, never the other pre-move location or `recovered`; performs no cgroup or descriptor operation and may retain unsafe/null cgroup observations |

A generation in `recovered` or `quarantined` without the matching inherited
decision, a generation in `closed` outside the exact state-18 case, a wrong
decision destination, a resumed-decision tuple that fails its exact row, or a
source/destination collision returns only
`INCONSISTENT_GENERATION_STATE_BLOCKED` or
`UNSAFE_FILESYSTEM_INVENTORY_BLOCKED`; it never guesses a move or creates an
attempt.

For a first fresh same-boot disposition, `00`, `10`, `01`, and `11` below mean
control/job absent or present. This matrix is exact:

| Normal head                                                               | Permitted presence        |
| ------------------------------------------------------------------------- | ------------------------- |
| null or `1 ADMISSION_INTENT_DURABLE`                                      | `00`                      |
| `2 CGROUP_EFFECT_INTENT_DURABLE`                                          | `00`, `10`, `01`, or `11` |
| `3 CGROUPS_CONFIGURED_EMPTY_OBSERVED` through `14 CLEANUP_INTENT_DURABLE` | `11`                      |
| `15 CGROUPS_QUIESCENT_OBSERVED`                                           | `00`, `10`, `01`, or `11` |
| `16 CGROUPS_REMOVED_OBSERVED` through `18 CLOSED_DURABLE`                 | `00`                      |

State 2 is durable before the first cgroup-creation effect. State 15 is durable
before the first cgroup-directory removal effect. Within a recovery prefix,
kill and quiescence records do not change pathname presence; a verified
`CGROUP_REMOVAL_INTENT_DURABLE` permits only present-to-absent transitions, and
`CGROUP_PATHS_ABSENT_OBSERVED` and every later state require `00`. An absent
pathname may never reappear. A verified different boot overrides the historical
presence matrix and requires `00` under the independently verified current
delegated root. Every other bounded tuple selects
`QUARANTINE/INCONSISTENT_GENERATION_STATE`; unsafe or unbounded inventory is a
pre-attempt block.

The exact quarantine reason is the first true predicate in this fixed order:

1. current boot null or unequal to the applicable expected current boot:
   `UNKNOWN_BOOT_ID`;
2. delegated-root identity null or unequal to the applicable expected identity,
   or a same-boot expected identity unequal to the target's historical identity
   (the later attempt projection must repeat the applicable expected identity):
   `DELEGATED_ROOT_IDENTITY_UNKNOWN_OR_DRIFTED`;
3. `reportedCgroupInventorySafe` false: `UNSAFE_CGROUP_INVENTORY`;
4. source/head/normal-state/presence/descriptor tuple violates these tables:
   `INCONSISTENT_GENERATION_STATE`;
5. `reportedRecoveryInterfaceAvailable` false while the otherwise derived
   non-quarantine branch selects a descriptor, pidfd/wait, or delegated-cgroup
   interface:
   `UNSUPPORTED_RECOVERY_INTERFACE`; or
6. replay-derived `derivedPriorEffectOutcomeCertain` false:
   `RECOVERY_EFFECT_UNCERTAIN`.

Presence is two booleans iff inventory-safe is true and exactly null/null iff
false; mixed pairs reject. State-filesystem availability is true before this
reason table is evaluated and is never a quarantine reason. `quarantineReason`
is null for both resume dispositions because their decision and original reason
are inherited transitively. Inventory and certainty are true for genesis,
same-boot, reboot, and recovered-decision resume; a selected non-filesystem
interface must also be available before its effect. Quarantine reports the
exact flags and first reason above. Quarantine-decision resume may preserve
false/null cgroup facts and either recovery-interface value because no branch
or effect depends on them.

Descriptor relationships are also exact. A recovery-only guardian reports all
four descriptor/pidfd/wait booleans false for every disposition. A live birth
guardian with null/state-1-through-3 head reports all four false because the
launch intent precedes descriptor creation. `reapProven` is true exactly when
the normal head is state 13 or later or verified recovery ancestry contains
`SUPERVISOR_REAPED_OBSERVED`; it is never a caller flag. Command and status are
independent exact held facts from states 4 through 16. At state 4 with no proved
reap, pidfd/wait is exactly `00` (no returned child observed) or `11`; at states
5 through 12 with no proved reap it is exactly `11`. With a proved reap, states
4 through 16 require wait false and permit pidfd/wait exactly `00` or `10`.
State 17 requires all four false; state 18 creates no attempt. Any held-pidfd,
false-wait tuple without a proved reap is inconsistent and selects quarantine;
the live guardian cannot abandon a known direct child.

Under required presence `11`, state 4 has eight live-birth shapes plus the one
recovery-only shape. States 5 through 12 have four live-birth shapes plus one
recovery-only shape before a proved reap and eight plus one after it. States 13,
14, and 16 have nine total shapes. State 15 has eight live-birth shapes plus the
one recovery-only shape across four presence tuples, so 36 remains the maximum
number of exact input shapes for one normal state. State 2 has eight and state
17 has two.

Brackets are not caller choices. Command close requires a held command
descriptor. Control absence replaces its kill and quiescence records; control
presence requires all three. Job absence replaces both kill rounds and
quiescence; job presence requires all five. EOF requires the held status pipe
and no verified EOF prefix. A held pidfd with `reapProven: false` records
`SUPERVISOR_PIDFD_READABLE_OBSERVED` and the exact plan must then perform the
direct-child wait; a held pidfd with `reapProven: true` records the distinct
`SUPERVISOR_PIDFD_HUP_OBSERVED` and performs no second wait. No held pidfd
records neither. Reap requires the live birth actor, pidfd, direct parentage,
exclusive wait authority, and no verified reap prefix. Removal intent appears
iff either cgroup path was present. The all-present live branch has 19 records.
Unknown names or a presence combination inconsistent with the verified normal
and recovery prefixes selects quarantine rather than an inferred branch.

After `RECOVERED_TOMBSTONE_DURABLE`, a fresh successor may follow only
`RECOVERY_ATTEMPT_DURABLE → RECOVERED_TOMBSTONE_ADOPTED →
RECOVERED_LOCATION_OBSERVED`. After `QUARANTINE_INTENT_DURABLE`, it may follow
only `RECOVERY_ATTEMPT_DURABLE → QUARANTINE_INTENT_ADOPTED →
QUARANTINED_LOCATION_OBSERVED`. Only the immutable decision source resumes the
already decided no-replace move; the other pre-move location is rejected. An
inherited recovered decision permits destination-
only completion from `recovered` and rejects `quarantined`; an inherited
quarantine decision permits destination-only completion from `quarantined` and
rejects `recovered`. Every finalized resume writes its matching `*_ADOPTED`
record even when already at the destination; "observation-only" means no new
move, kill, descriptor, or cgroup effect, not omission of the adoption record.
A successor never restarts killing, reverses a durable terminal decision, or
writes a second terminal decision. A terminal recovered or quarantined location
rejects every later attempt.

Decision inheritance is transitive across the complete predecessor lineage.
Once any verified ancestor contains a recovered tombstone or quarantine intent,
every later empty or finalized attempt retains that one inherited decision. A
resume actor that crashes after its attempt record or adopted-decision prefix
does not erase the ancestor: the next actor must continue the same resume plan.
Replay rejects a fresh kill/genesis/reboot/quarantine branch after an inherited
recovered decision, a non-quarantine branch after an inherited quarantine
decision, and every conflicting second durable decision.

Before any terminal decision exists, a successor after an arbitrary nonterminal
prefix always begins a new actor and record-1 manifest; it never appends to the
prior actor. It binds the entire predecessor head and re-derives one disposition
from current verified facts. It may repeat only the deterministic idempotent
plan that those facts permit. An unresolved earlier intent/effect selects
`QUARANTINE/RECOVERY_EFFECT_UNCERTAIN`; callers cannot choose a fresh branch or
skip to a later state.

The finite unresolved-effect set is exactly
`COMMAND_DESCRIPTOR_CLOSE_INTENT_DURABLE`,
`CONTROL_KILL_INTENT_DURABLE`, `JOB_FIRST_KILL_INTENT_DURABLE`,
`JOB_SECOND_KILL_INTENT_DURABLE`, `SUPERVISOR_REAP_INTENT_DURABLE`, and
`CGROUP_REMOVAL_INTENT_DURABLE`. An intent is resolved only by its exact next
completion/observation record in the same verified attempt; if that attempt
ends at the intent, later reported held descriptors, pidfd state, cgroup
presence, absence, or idempotence do not reconstruct the missing outcome and
cannot change false back to true. `RECOVERED_TOMBSTONE_DURABLE`,
`QUARANTINE_INTENT_DURABLE`, and their adoption records are durable decisions,
not uncertain effects, and enter only the inherited resume graph. Every other
valid nonterminal tail preserves the previously derived certainty value.

Each generation directory contains an exact immutable `generation.jsonl`, a
`normal/` directory for v2 bundles, and an initially empty `recovery/`
directory. Attempt directories use the full recovery-actor digest and contain
only that actor's write-once records. A live birth guardian leaves the normal
prefix unchanged and starts a fresh, distinct recovery actor lineage on any
nonterminal failure; a replacement guardian does the same after acquiring the
root lock. Only the live birth guardian may close an actually held command
descriptor or record a direct-child wait; a replacement never reconstructs,
closes, or reports the dead guardian's anonymous pipe.

An exact null-head generation follows the genesis or reboot row above; allowing
`active` closes the activation-before-first-bundle crash window. State 18 is
evaluated before recovery-actor allocation. An exact singleton `active`, safe
control/job `00`, non-null verified current boot, applicable verified current
delegated root, and zero-entry recovery replay returns only authority-null
`CLOSE_MOVE_REQUIRED`: no recovery actor, attempt, record, cgroup, process, or
descriptor action, only the normal no-replace close mechanics. The same exact
facts in singleton `closed` without a branded normal-close receipt also return
`CLOSE_MOVE_REQUIRED`, but as destination-only completion: repeat sync of both
the `active` and `closed` parents, exactly reobserve the closed identity, then
persist the lifetime close receipt. Only a later plan with that exact complete
receipt returns `CLOSED_LOCATION_OBSERVED` with no further action.
State 18 in `staging`, `recovered`, or `quarantined`, any present/null cgroup
tuple, any descriptor action, any recovery lineage, unknown boot/root, or an
active/closed collision returns only
`INCONSISTENT_GENERATION_STATE_BLOCKED` or
`UNSAFE_FILESYSTEM_INVENTORY_BLOCKED`. A proved boot difference does not
reclassify state 18 as reboot recovery.

Recovery closure writes and directory-syncs
`RECOVERED_TOMBSTONE_DURABLE` as the move decision. Quarantine closure writes
and directory-syncs `QUARANTINE_INTENT_DURABLE`. A resume first writes and
directory-syncs its matching adoption record. The owner then verifies a unique
permitted source equal to the immutable `decisionSourceLocation` and an absent
destination, moves the complete generation with `RENAME_NOREPLACE`, syncs the
decision-source and destination parents, and reobserves decision-source absence
plus the destination's exact directory identity, manifest,
target, and recovery head before writing and directory-syncing the matching
location-observed record. Destination-only completion still syncs and
reobserves the immutable decision-source parent plus the matching destination,
not the destination as a substitute source, before that final record. Both
present, neither present,
wrong destination, or identity mismatch blocks without another move. It never
appends or fabricates a normal-v1 state. Normal state 18 closes only through
`active/` to `closed/` with the equivalent no-replace, dual-parent-sync, and
exact-location observation rules, followed by the branded lifetime close
receipt before terminal clearance.

Restart inventory covers all five generation lifecycle directories. One
generation digest may occur in exactly one of them; source and destination
simultaneously containing it is unsafe duplication. Attempt-directory names are
full lowercase recovery-actor digests, and a new-actor collision is rejection,
never reuse. Destination-only resume requires an exact manifest, immutable
target, durable decision prefix, and external lifetime-ledger head. Unknown
files or directories, symlinks, hard links, malformed names, multiple
successors, or unanchored empty attempts block recovery and admission without
authorizing a generation move. The exact control and job names may be
independently absent or present only when the verified normal/recovery prefix
permits that combination; every other delegated-root entry quarantines the
root.

Use one canonical JSON-line file per inner record, bundle, or recovery record
rather than a mutable append tail. Normal-v1, bundle-v2, and recovery-v1 retain
their distinct exact shapes above. Every final filename contains its fixed-width
sequence and recomputed raw digest.

Every record is persisted in this order:

1. create a unique temporary regular file relative to the held journal
   directory with `O_CREAT|O_EXCL|O_NOFOLLOW` and mode `0600`;
2. perform bounded full writes and read back the exact bytes;
3. `fsync` the file;
4. use `renameat2(..., RENAME_NOREPLACE)` to its write-once final name; and
5. `fsync` the journal directory before the governed external effect begins.

A generation directory is built and synced in staging, moved into `active/`
with `renameat2(..., RENAME_NOREPLACE)`, and followed by `fsync` of both the
staging and `active/` parent directories. Only then may normal bundle 1 be
finalized and directory-synced, and only after bundle 1 may the first governed
cgroup effect begin. A staging generation with a non-null normal head is
therefore invalid; active with a null head is the real activation-before-first-
bundle crash window. Closing moves
the complete directory into `closed/` with the same no-replace rule and syncs
both the `active/` and `closed/` parents. Closed records are retained as
generation tombstones. Unexpected files, symlinks, hard links, ownership or
mode drift, sequence gaps, multiple successors, noncanonical bytes, hash-chain
failure, or replacement failure quarantine the root and block admission.

The sequence-18 inner `CLOSED_DURABLE` bundle is written and directory-synced
while the generation is still in `active/`; in v1 it is the durable close/move
decision, not evidence that the directory move occurred. A complete chain still
observed in `active/` therefore has the finite physical disposition
`CLOSE_MOVE_REQUIRED`. Only a no-replace `active/` to `closed/` move, sync of
both parents, and subsequent exact inventory observation may support a physical
closed-location fact. Pure bundle replay keeps that fact null.

State-filesystem sync errors are terminal recovery requirements. Cgroupfs
configuration writes make no `fsync` claim and are established only by exact
bounded readback. `cgroup.kill` is the deliberate exception: it is write-only,
so a completed write is recorded separately and its effect is established only
by subsequent recursive emptiness observations, never by reading that file
back.

### Linux feature and delegation gate

The first qualified platform baseline is Linux 5.14 or later, but version text
alone grants no capability. The physical owner probes every required syscall,
flag, interface, filesystem operation, controller, and permission and fails
closed on unsupported or denied results, including `ENOSYS`, `EPERM`, `EACCES`,
`EBUSY`, and `EOPNOTSUPP` where applicable.

The delegated parent and every target are cgroup v2 ordinary `domain` cgroups,
never threaded or domain-invalid. The exact topology is compatible with
`CLONE_INTO_CGROUP`; no target has a domain controller enabled in its own
`cgroup.subtree_control`. The trusted manager proves the exact cgroup2 mount,
namespace reachability, UID, GID, modes, common-ancestor and destination
`cgroup.procs` permissions, directory creation/removal authority, controller
files, and `cgroup.kill` access. The `pids` controller is present and enabled in
the delegated parent's subtree so that each non-root child exposes
`pids.current`. No actor outside the manager/guardian lifetime may migrate or
clone processes into the owned subtree.

### Cancel-only transition graph

The first physical schema accepts no `COMMIT` and permits no payload clone. Its
normal transition graph is exactly:

```text
ADMISSION_INTENT_DURABLE
→ CGROUP_EFFECT_INTENT_DURABLE
→ CGROUPS_CONFIGURED_EMPTY_OBSERVED
→ SUPERVISOR_LAUNCH_INTENT_DURABLE
→ SUPERVISOR_EXEC_OBSERVED
→ LAUNCHER_DESCRIPTOR_CLOSURE_OBSERVED
→ PREFLIGHT_READY_OBSERVED
→ DECISION_CANCEL_DURABLE
→ CANCEL_WRITE_COMPLETED
→ CANCELLED_WITHOUT_CLONE_OBSERVED
→ SUPERVISOR_DONE_OBSERVED
→ STATUS_EOF_OBSERVED
→ SUPERVISOR_REAPED_OBSERVED
→ CLEANUP_INTENT_DURABLE
→ CGROUPS_QUIESCENT_OBSERVED
→ CGROUPS_REMOVED_OBSERVED
→ GUARDIAN_DESCRIPTORS_CLOSED_OBSERVED
→ CLOSED_DURABLE
```

Intent is durable before each governed cgroup, launch, decision, cleanup, or
removal effect. Exact raw status bytes, EOF, pidfd readability, direct-child
reap, cgroup readbacks, removal absence, and descriptor-close results remain
distinct evidence. No reducer synthesizes `cleanupSafe` from aggregate
booleans.

The normal graph contains only successful cancel-only observations. Any live
guardian failure stops that chain at its honest prefix and starts the separate
recovery lineage; no state is skipped or invented. The sole exception is a
complete state-18 chain still in `active`, which follows only the normal
`CLOSE_MOVE_REQUIRED` plan above. A live birth guardian may retain and record
its actual parentage, pidfd, wait, and pipe observations while recovering. A
replacement recovery actor reports the four attempt descriptor/pidfd/wait
booleans false; the corresponding historical physical facts remain null. An exact staging or
active generation with no v2 head follows the bounded genesis or proved-reboot
row above only when both cgroup paths are absent; unknown or inconsistent identity, location,
head, or cgroup state quarantines rather than guessing whether an effect began.

For each direct child, the parent uses `exit_signal=SIGCHLD`, omits
`CLONE_PARENT` and `CLONE_THREAD`, keeps SIGCHLD waitable without `SIG_IGN` or
`SA_NOCLDWAIT`, and has one exclusive waiter with no racing handler. `POLLIN` or
`EPOLLIN` on the returned pidfd records termination/zombie readability, not
reap; `EPOLLHUP` is a distinct post-reap condition. Direct-child reap requires
one successful `waitid(P_PIDFD, pidfd, ..., WEXITED)` without `WNOWAIT` (and a
null fifth `rusage` argument in the raw syscall ABI). Status EOF, cgroup
quiescence, pidfd readability, and waitid reap remain four independent facts.

A future additive schema may introduce `COMMIT` only after its exact bytes and
all request, epoch, generation, and READY bindings are durably recorded and the
file plus directory syncs succeed. An ambiguous commit-pipe write permanently
invalidates application output; recovery never retransmits commit or reuses the
generation.

### Restart recovery

After acquiring the exclusive state-root lock, a restarted manager first
verifies the held state-root identity read-only and replays the existing
lifetime ledger. If that identity is uncertain, it records nothing and stops.
For an incomplete lifetime whose admission guardian is absent, the manager then
durably consumes a fresh recovery-actor epoch and exact target heads in the
lifetime ledger and launches the exact guardian executable in the recovery-only
mode and the applicable ledger-bound same-boot or proved-reboot recovery
lifetime described above. The launch has the same bounded
pre-exec-syscall trace, positive exec stop, held-file/live-`/proc` binding,
pidfd, membership, and durable pre-release receipt as a normal launch. The
recovery guardian adopts that epoch, verifies the boot ID, delegated root,
cgroup2 mount, controllers, and subtree identities, and only then starts its
separate recovery-ledger attempt. A live birth guardian entering recovery
instead obtains and durably records its own fresh recovery actor before the
first recovery effect; it does not relaunch itself.

The recovery actor inventories `staging`, `active`, `closed`, `recovered`, and
`quarantined`, replays every exact v2 bundle/inner-v1 chain and recovery attempt,
and compares every permitted incomplete generation with actual cgroup entries.
Uncertainty about the delegated root permits a durable state-root quarantine
record but no delegated-root mutation. New admission remains blocked until all
incomplete known generations are reconciled.

For an incomplete same-boot generation with a still-exact delegated root, the
actor executes only its derived finite plan and persists an intent before every
external effect. A live birth guardian closes only a command descriptor it
actually holds; a replacement records no pipe operation or observation.
Control and job absence are independent branches. For a present control path,
the actor writes `1` to `cgroup.kill` and later observes quiescence. For a
present job path, it performs the first kill, then a second kill after control
quiescence to close the supervisor-to-job clone race, and observes job
quiescence through `cgroup.events populated 0`, exact empty `cgroup.procs`, and
`pids.current=0`. It records held status EOF, pidfd readability, and direct-child
reap only through their separately gated states, then persists removal intent
iff a path was present, removes only exact bound names, and reobserves absence.
Completed kill writes and later emptiness observations remain distinct records.
Replacement recovery keeps supervisor/candidate reap, exit status, pipe
history, and application result null.

The fixed inner-v1 label `CGROUPS_REMOVED_OBSERVED` means only that removal of
the exact bound cgroup pathnames completed and their names were reobserved
absent. It does not claim that an internal kernel cgroup object has left a
dying state, and unique full names plus exclusive mutation prevent an absence
check from being confused with recreation.

A different boot ID records interruption by reboot and current-root
observations without claiming historical cleanup. Unknown cgroups, corrupt
journals, root-identity drift, revoked delegation, unsupported `cgroup.kill`,
timeouts, permission failures, unexpected descendants, or failed removal
quarantine the root. If root identity is uncertain, recovery performs no
mutation and requires operator intervention.

### Executable supervisor preflight

The first executable supervisor successor uses `PREFLIGHT_READY`, not the
existing bootstrap-v3 `READY`. It parses bounded canonical START/CAPSULE/CANCEL
envelopes, strictly decodes canonical base64, proves decoded raw-capsule SHA-256
equality, rebinds repeated request/generation/requirements digests, validates
the structural descriptor map, rejects `COMMIT`, emits the cancel-without-clone
terminal sequence, closes status, and exits with the frozen cancel-success
status.

It explicitly reports semantic launch-capsule validation, retained-file content
identity, cgroup configuration, physical eligibility, final-decision
eligibility, binding, and every authority as null or false. Existing JavaScript
verification remains responsible for full capsule semantics until a later
native implementation differentially reconstructs the complete projection.

Compile/source/ELF attestation and actual execution evidence are separate.
Execution evidence must bind the held executable to a race-free exec event and
live `/proc/<pid>/exe` device/inode, exact transcript bytes, pipe identities and
EOFs, bounded diagnostics, direct-child pidfd/waitid reap, and the journal
generation. Neither a source attestation nor a replay transcript proves that
the executable ran.

### Evidence and activation boundary

Normal local tests may exercise the pure transition model, exact additive
bundle and recovery-ledger bytes, corrupt and crash-prefix replay, private
temporary-directory write/sync/rename mechanics, disposable process
pipe/descriptor behavior, deterministic native compilation, and an executable
preflight that performs no cgroup mutation. These prove bounded contract and
syscall behavior, not physical journal execution, power-loss durability, or
containment.

Actual delegation, cgroup creation/readback/kill/removal, guardian and
supervisor death injection, `clone3` placement, migration resistance, reboot,
and power-cut behavior require an explicit isolated delegated host or VM and
separate receipts. Those runs are not G1.7 and cannot activate production,
application receipts, task/profile registration, qualification, promotion, or
publication.

### Current implementation checkpoint

Commit `ab668ddd` implements the pure journal boundary in
[`containment-guardian-journal-v1.mjs`](../../tools/engineering-harness/src/candidate/containment-guardian-journal-v1.mjs)
and its focused
[`candidate-containment-guardian-journal-v1.test.mjs`](../../tools/engineering-harness/test/candidate-containment-guardian-journal-v1.test.mjs):

- canonical semantic projections determine projection digests, while the final
  LF participates only in each raw-record SHA-256 and its fixed-width
  sequence-plus-digest filename;
- replay requires the exact generation identity and birth guardian epoch,
  optionally anchors the expected raw head, and binds each state-specific
  operation and evidence projection to the state, sequence, identity, actor,
  and predecessor;
- standalone record verification reports `hashChainValidated: false`; only
  supplied-chain replay may report a validated chain, and complete and prefix
  inputs remain distinguished as `COMPLETE_RECORD_CHAIN_REPLAYED` and
  `VALID_RECORD_PREFIX_REPLAYED`;
- physical recovery, filesystem inventory, and durability facts remain null;
  every application-receipt, publication, execution, containment,
  qualification, promotion, and other authority is false, with explicit
  nonclaims; and
- the focused suite passes 14/14 and the explicit related non-G1.7 matrix
  passes 262/262 on both the current Node runtime and Node 20. A clean
  committed-code identity control passes 2/2 on both runtimes, and three
  independent contract, adversarial, and compatibility reviews returned GO
  for this bounded pure scope.

Commit `040f3343` implements the next authority-null, test-local executable
preflight checkpoint in
[`containment-supervisor-preflight-v4.c`](../../tools/engineering-harness/src/candidate/containment-supervisor-preflight-v4.c),
its exact
[`containment-supervisor-preflight-attestation-v4.mjs`](../../tools/engineering-harness/src/candidate/containment-supervisor-preflight-attestation-v4.mjs),
and the native success, fault, and fixture tests:

- the reviewed source is 86,913 bytes with SHA-256
  `3d7adb007efb240a2ef3cf495b692d4675c9a04f948dd8e067d3c315a8a460f5`;
  its 1,799-byte self-description has SHA-256
  `3e6da2813ca478f657820ca7e12259d685524befc56ab06d1c087dc5396b802c`;
  three exact builds each produced the same 32,544-byte execution copy with
  SHA-256
  `3839a44c93f3067cf3ab8e61fdebf2627d3928a66dd7192a8f296496cb1ba577`;
- a separate parent-held descriptor is `fstat`-bound through `PREFLIGHT_READY`;
  before capsule preflight the child exposes exactly FDs 0-19, with FD 18
  matching that executable and FD 19 matching the private close-range sentinel;
  at `PREFLIGHT_READY` exactly FDs 0-17 remain, with the required structural
  kinds, access modes, and pairwise non-aliasing;
- the live `/proc/<pid>/exe` metadata and independently read bytes match the
  intended execution-copy identity, no child exists at READY, and the exact
  `PREFLIGHT_READY` / `CANCELLED_WITHOUT_CLONE` / `SUPERVISOR_DONE` bytes,
  status EOF, empty success diagnostics, and exit 124 are observed;
- thirty returned descriptor, protocol, I/O, timeout, trailing-byte, O_PATH,
  and diagnostic-sink fault scenarios fail with their exact classification,
  await process and stream closure, and remove only their private roots; a
  separate synthetic collector test rejects a fourth status frame; and
- the replay deliberately leaves semantic capsule/content validation,
  cgroup facts, FD-6 execution binding, cleanup outcome, direct-child
  pidfd/waitid reap, physical eligibility, final eligibility, and every
  authority null or false. Node's child `close` event plus post-reap `/proc`
  identity check is test-local close/reap observation, not pidfd/waitid or
  stable-guardian authority.

The combined focused suite passes 47/47 and every top-level non-G1.7 harness
test except the separate committed-clean identity control passes 495/495 on
both the current Node runtime and Node 20. After commit, that identity control
passes 2/2 on both runtimes. Two fresh independent native-fixture and
contract/security reviews returned GO for exactly this bounded checkpoint.

Commit `c2abb0df` implements the additive authority-null persistence format in
[`containment-guardian-journal-v2.mjs`](../../tools/engineering-harness/src/candidate/containment-guardian-journal-v2.mjs)
and its focused
[`candidate-containment-guardian-journal-v2.test.mjs`](../../tools/engineering-harness/test/candidate-containment-guardian-journal-v2.test.mjs):

- the immutable generation manifest and each of the 18 exact v2 bundles bind
  the unchanged inner-v1 bytes, canonical operation/evidence bytes, raw and
  semantic digests, fixed-width sequence, dual predecessors, and repeated
  generation identities;
- standalone verification and supplied-chain replay remain distinct, every
  operation/evidence payload stays opaque, and exact nonclaims deny origin,
  parentage, actor continuity, boot identity, durability, effect, recovery,
  containment, application-receipt, qualification, promotion, and publication
  authority;
- strict canonical framing, padded base64, size ceilings, immutable metadata,
  copy-on-read bytes, complete and every-prefix replay, descriptor/manifest
  tamper, fork, gap, substitution, inner/v2 predecessor drift, hostile object,
  and mutable-buffer cases fail closed; and
- requirements SHA-256 is
  `95a4311224d8dfa5f481436e87da4b4d5f56a00d67278e7ed0e931476b584e26`;
  source and focused-test SHA-256 values are respectively
  `0fd3751914828519300cdcb3d327824ce78c5b95e5a9acd7211a376b548f0075`
  and
  `e1a6d3462f5dbe8f2bfe1227094bf26863c144e540cd9625911dd553ba58fe9b`.

The unchanged-v1 plus v2 focused suite passes 25/25, the complete explicit
non-G1.7 harness matrix passes 508/508, and the clean committed-code identity
control passes 2/2 on both the current Node runtime and Node 20. Two independent
contract and adversarial reviews returned GO for this bounded pure slice. Two
separate recovery-contract audits returned NO-GO for recovery-v1 code until the
finite schema, inventory rules, external head anchor, attempt ceilings, and
branch graph are ratified below.

Commit `2f901134` implements the additive authority-null lifetime boundary in
[`containment-guardian-lifetime-v1.mjs`](../../tools/engineering-harness/src/candidate/containment-guardian-lifetime-v1.mjs),
with its frozen evaluator and two independent adversarial suites:

- production independently constructs the exact frozen 29-row null-prototype
  relationship matrix and derives SHA-256
  `51433108d1ce01bb1492c01fd18140fe290782f4a54a31f7d2c80f8dae64d8ab`;
  the 85-field requirements projection remains
  `764975dd915913db4c4e0fc7bee308f8cb830c5f972ac0b97355601e7ff1b773`
  and the public surface remains exactly 56 named exports;
- identity creation, verification, record admission, and replay share one
  fresh, role-distinct actor/epoch boundary; guardian and recovery process
  phases are segment-bound and terminal-monotonic; configured reboot
  supersession remains sticky; target genesis covers the configured historical
  normal context and every intervening segment; and removal seals the exact
  absence-and-close suffix;
- prospective semantic reserve validation runs before final record
  canonicalization, while replay checks exact record counts and intrinsic Buffer
  lengths before allocation, parsing, base64 decoding, hashing, or sorting;
  hostile Proxies and poisoned Buffer length accessors reject without invoking
  their traps; and
- the final source SHA-256 is
  `f454ee962615e887c294f4aabade6a640ac1881fd3662842b75a3be8afb8f3e5`;
  the frozen, semantic-adversarial, and security-adversarial evaluator SHA-256
  values are respectively
  `afbb8909a89850c4974e06ddb29d96ec300bb6cbe0797f8caab07ece44ddc697`,
  `cb9c1cfc8afd91e05c12c7feceea639e3e4c3b3e96320931d3357ac6faed464c`,
  and
  `271bf1ac921d90c036b554a01474250ec9b16f505b340736b318c16fc6eb7d46`.

The three lifetime suites pass 45/45 on both Node 24 and Node 20. The official
ADR graph passes 1/1, the programme evidence suite passes 25/25, source-only
programme verification passes, and two independent final exact-hash reviews
return GO with no P0/P1 findings. The complete harness passes every behavioural
and committed-control test on both runtimes; its sole fail-closed result is the
deliberate G1.7 identity guard reporting product paths changed after the old
sealed e9 subject. This checkpoint does not refresh that subject or convert its
stale seal into qualification evidence.

The recovery-v1 checkpoint followed the evaluator-first RED-to-GREEN sequence:

- the independent fixture, evaluator, and `exactRecord` seam froze the exact
  99-field requirements oracle with SHA-256
  `278031a43b331036e6c849f796d480e7fe680219d07bdb5b30185668a9337c5a`
  and the exact 53-name public surface before production implementation. Their
  original RED proved source absence with `ERR_MODULE_NOT_FOUND` on Node 24 and
  Node 20, while the source-independent seam retained trap-free rejection;
- commit `2f2d1641` added the authority-null deterministic constructor, replay,
  planner, attempt boundary, and recovery reducer. An independent review then
  found a target replay-origin refresh whose late failure could commit private
  state prematurely; commit `5a3d63e8` moved that commit after all fallible
  work, and commit `3c4294cc` added the early- and late-failure regression
  controls;
- the final source, evaluator, fixture, and seam SHA-256 identities are
  respectively
  `e8873c848411bb719139962d1940f0bdb825e09e0df079345ae95cf01c598c1d`,
  `8c326d8823a02f54eef65eed236323ea7e1641a946c2994c4606ea1f5bde653a`,
  `d956a9952d479617ee672470ca7a390225cbeb681b916ba3ce8255470c748076`,
  and
  `eab46c8acfe8964121f8fb9cdfef1b9e4da32df9b763fc15423a0bdedb268af0`;
  and
- the final recovery evaluator passes 76/76, the independent seam passes 1/1,
  and the predecessor regression envelope passes 102/102 on both Node 24 and
  Node 20. Independent contract and exact-hash review returned GO after the
  failure-atomicity repair.

This GREEN checkpoint implements only the pure recovery-v1 value boundary. It
does not prove a filesystem effect or recovery outcome and grants no
containment, qualification, promotion, publication, or production authority.

No live G1.7 control, provider, benchmark, qualification, promotion, or
publication path ran for this checkpoint. The additive journal-bundle v2,
generation manifest, lifetime-v1 ledger, and recovery-v1 module now exist only
as pure authority-null contracts. Filesystem journal creation, sync and
no-replace mechanics, stable native manager and guardian/reaper execution,
recovery mutation, delegated-cgroup qualification, race-free exec/pidfd
evidence, and the production native adapter remain unimplemented. Production
readiness therefore remains exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`.

## Acceptance boundary

The implementation must prove:

- the dormant supervisor source/attestation, bootstrap-v3 bytes, schema-v1
  fixtures, registries, and production readiness remain byte-identical;
- additive v2 bundles embed and bind independently verified, byte-identical v1
  records plus exact canonical operation/evidence bytes without converting
  their reported projections into physical facts;
- recovery records use a separate actor lineage and exact v2 head, boot, and
  root bindings without appending to the birth guardian's v1 chain;
- the lifetime ledger durably consumes the raw manager epoch before any effect,
  covers every manager/guardian crash prefix, and prevents concurrent or stale
  delegated-root mutation;
- journal construction, replay, and recovery reject every malformed, stale,
  reordered, duplicated, aliased, or ambiguous state and enumerate every
  allowed transition and terminal reason;
- every durable physical bundle, lifetime-ledger record, or recovery record
  uses write, file sync, no-replace rename, and directory sync before its
  governed effect, with injected failure before and after every boundary;
- controller loss with a live guardian cancels, drains, reaps, reconciles, and
  closes, while guardian loss never reconstructs direct-child reap authority;
- exact manager and guardian sources, compiler/recipe, self-descriptions, and
  repeated static Linux x86-64 ELF builds are independently attested before
  either executable may own a physical effect;
- the service-manager trust root and then the manager prove their respective
  manager and guardian launches at a positive race-free exec stop, bind each
  held executable to live `/proc/<pid>/exe` device, inode, and independently
  read bytes, durably record the exact receipt, and release no executable to
  own effects before that proof; the guardian launch additionally proves an
  exact non-mutating pre-exec syscall trace;
- held target-cgroup identity, one `clone3(CLONE_INTO_CGROUP | CLONE_PIDFD)`
  launch, exact live membership, pidfd termination, and exclusive direct-child
  wait evidence prove initial placement without a post-launch migration;
- the new native supervisor is compiled twice from exact attested sources into
  byte-identical static Linux x86-64 executables and the old artifact is never
  executed;
- safe local execution proves only preflight framing, raw-capsule hash, FD
  structure, cancel-only terminal bytes, EOF, zero successful diagnostics,
  exit, and Node child close/post-reap observation—not pidfd/waitid—while
  semantic/cgroup/authority facts remain null or false;
- explicit delegated-host tests prove the exact physical cgroup lifecycle
  before any production readiness change; and
- current and Node 20 focused plus full explicit non-G1.7 suites pass, followed
  by independent ADR, compatibility, security, and MetaHarness review.

## Consequences

- Controller restarts no longer require pretending that process parentage or
  pidfds are durable.
- Intent-first records make ambiguous effects visible and keep future commit
  recovery conservative.
- The guardian becomes a small security-critical native component with a
  larger fault-injection and delegated-host qualification burden.
- Cancel-only local execution creates real evidence without weakening the
  production boundary or requiring a live G1.7 run.
- A production service-manager unit, dedicated delegated cgroup parent, exact
  filesystem qualification, and operator quarantine workflow remain required.

## Alternatives rejected

- **Restart one process and reopen the pidfd.** The replacement is not the
  supervisor's parent and cannot claim direct-child reap.
- **Execute bootstrap v3 against a temporary directory.** Its READY fields
  report cgroup and retained-descriptor facts the fixture cannot substantiate.
- **Trust guardian prevalidation as native semantic validation.** Matching a
  supplied projection digest does not reconstruct the launch capsule.
- **Append one mutable JSONL journal.** A torn tail and ambiguous update weaken
  exact write-once replay and no-replace successor checks.
- **Turn journal v1 into the physical schema in place.** Its projections are
  intentionally reported digests, its actor must equal the birth guardian, and
  executable preflight v4 depends on its exact sequence-8 record.
- **Let the guardian choose its lifetime-cgroup epoch after launch.** That makes
  the service manager depend on a name that does not yet exist and requires an
  avoidable intermediate migration before the guardian can validate placement.
- **Signal persisted PIDs during recovery.** Numeric PID reuse is not an
  identity-bearing authority.
- **Treat cgroup emptiness as reap.** Quiescence and direct-child wait are
  independent facts.

## References

- [Linux cgroup v2 documentation](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)
- [Linux `pidfd_open(2)`](https://man7.org/linux/man-pages/man2/pidfd_open.2.html)
- [Linux `waitid(2)`](https://man7.org/linux/man-pages/man2/waitpid.2.html)
- [Linux `fsync(2)`](https://man7.org/linux/man-pages/man2/fsync.2.html)
- [Linux `getrandom(2)`](https://man7.org/linux/man-pages/man2/getrandom.2.html)
- [Linux `flock(2)`](https://man7.org/linux/man-pages/man2/flock.2.html)
- [Linux `clone3(2)` cgroup and pidfd creation](https://man7.org/linux/man-pages/man2/clone.2.html)
- [Linux `pidfd_send_signal(2)`](https://man7.org/linux/man-pages/man2/pidfd_send_signal.2.html)
- [Linux `cgroups(7)`](https://man7.org/linux/man-pages/man7/cgroups.7.html)
- [Linux `rmdir(2)`](https://man7.org/linux/man-pages/man2/rmdir.2.html)
- [Linux `renameat2(2)`](https://man7.org/linux/man-pages/man2/rename.2.html)
