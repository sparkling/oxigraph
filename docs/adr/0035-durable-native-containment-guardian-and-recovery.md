# ADR-0035: Durable native containment guardian and crash recovery

- **Status**: Proposed
- **Date**: 2026-08-29
- Updated: 2026-08-29
- Deciders: Oxigraph parity programme
- Implementation status: partially implemented and still unregistered. Commit
  `ab668ddd` adds local-only, authority-null journal construction and replay for
  the exact cancel-only transition graph. Commit `040f3343` adds the separate
  local Linux x86-64 execution-copy fixture for the attested executable
  preflight, including structural descriptor observation, exact cancel-only
  transcript checks, bounded fault handling, and test-root cleanup. It does not
  write or recover a filesystem journal, run the stable native guardian, mutate
  a delegated cgroup, prove pidfd/waitid reap, or bind the executable through
  the ADR's race-free launch event, and it remains absent from runtime,
  task-profile, and CLI registries. The next permitted slice is the
  additive physical-bundle and recovery-ledger contracts around the unchanged
  journal-v1 bytes. The separate lifetime-ledger and guardian-control contracts
  must then close before any filesystem-backed manager/guardian owner begins;
  no existing slice may activate production containment, G1.7, G2.2,
  qualification, promotion, or publication
- Programme task: `task-1788002473147-nsat6x` (75% at checkpoint `040f3343`)
- Contract-first successor task: `task-1788008900651-u20s3l` (in progress)
- **Depends on**:
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0034 — First-class exact new-file admission](0034-first-class-exact-new-file-admission.md)
- **Related**:
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md)

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
this descriptor map, exact bounded initialization and admission frames,
`SCM_RIGHTS` count and role validation, controller-loss response, status frames,
limits, and finite failure reasons before native manager or guardian code is
permitted. It accepts neither root paths nor injectable filesystem, cgroup, or
process-mechanics callbacks.

The same contract has a separate recovery-only exec mode with exactly FDs 0
through 6: FD 0 is a read-only bounded canonical recovery-request pipe; FDs 1
through 5 retain their status, diagnostics, locked state-root, delegated-root,
and old lifetime-cgroup roles; and FD 6 carries exactly 32 raw bytes for a fresh
recovery-actor epoch then EOF. No controller socket, supervisor executable, or
admission descriptor is present, and FDs 7 and above are absent. Recovery mode
cannot admit work, launch a supervisor, emit application output, or reuse the
normal birth actor.

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

If the admission guardian dies or cannot finish its own recovery, the manager
does not mutate `ctl` or `job` itself and does not create a new lifetime. It
durably consumes a fresh recovery-actor epoch in the existing lifetime ledger,
records recovery-launch intent with the exact incomplete generation heads, and
uses `clone3(CLONE_INTO_CGROUP | CLONE_PIDFD)` to launch the attested guardian
binary in recovery-only mode directly into the still-held old lifetime cgroup.
The recovery guardian adopts the same locked state-root open description and
old lifetime epoch but has a distinct recovery actor. Its exact launch,
membership, pidfd, exec, bounded recovery result, termination, and direct-child
wait are lifetime-ledger records. It alone reconciles the old generation-bound
`ctl` and `job` siblings. A failed recovery guardian leaves an honest prefix;
the manager may launch a bounded subsequent attempt with another fresh actor or
quarantine. Only after all old generations are terminal and all old cgroup
pathnames are absent may the manager remove the old lifetime cgroup, close its
ledger, and consume a new lifetime epoch.

Roles do not race over the delegated root. The manager alone creates,
configures, directly launches into, and later removes the lifetime cgroup; after
admission-guardian exec its only permitted delegated-root actions are direct
recovery-guardian launch into that same lifetime and the intent-bound lifetime
cleanup above. Admission and recovery guardians never mutate their lifetime
cgroup and alone own the bound `ctl` and `job` names. Recovery finishes every
exact old lifetime and admission generation—including pathname absence—before
a replacement manager may consume a new epoch. Inventory admits exactly the
current ledger-bound lifetime cgroup plus its generation-bound `ctl` and `job`
siblings; any other entry quarantines the root.

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
name. Admission rejects a collision with active, closed, or quarantined journal
generations and with any existing cgroup entry. Serialized epoch equality
remains an identity binding only; it never proves freshness, process continuity,
or actor origin.

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

The held state root has exactly six owner-created directories named
`lifetimes`, `staging`, `active`, `closed`, `recovered`, and `quarantined`; the
exclusive lock is held on the already-open state-root directory itself and
introduces no lock pathname. Generation directory names are the full
generation-identity digest. A generation cannot appear in more than one
lifecycle directory. Unknown root entries, duplicate generations,
temporary-file residue outside the exact bounded staging grammar, aliases, or
unsafe metadata require quarantine rather than being ignored. Malformed or
noncanonical serialized input is rejected; canonical inventory observations
that truthfully report an unsafe condition produce a finite quarantine
disposition. Neither outcome grants mutation authority.

Recovery uses a separate recovery-ledger v1 lineage. It targets an exact
generation identity, the exact raw SHA-256 of `generation.jsonl`, and either the
latest verified v2 bundle head or the exact genesis binding
`{latestBundleRawSha256: null, latestBundleSequence: null}`. It names both the
birth guardian epoch and a fresh recovery actor epoch, binds the observed boot
relationship and root identities, and enumerates finite intent, observation,
reboot-interruption, quarantine, and recovered-closure outcomes. A recovery
actor never appends to or impersonates the birth guardian's normal v1 chain.
Pure bundle/recovery construction, verification, replay, and planning remain
descriptive and authority-null; only the later native physical owner may turn
verified bytes and held descriptors into filesystem or cgroup facts.

Each generation directory contains an exact immutable `generation.jsonl`, a
`normal/` directory for v2 bundles, and an initially empty `recovery/`
directory. Recovery attempt directories are named by the full recovery-actor
epoch digest and contain only that actor's write-once recovery records. A live
birth guardian leaves the normal v1/v2 prefix unchanged and starts a fresh,
distinct recovery actor lineage on any failure; a replacement guardian does the
same after acquiring the root lock. The lineage records whether the actor still
has direct-child/pipe authority. Only the live birth guardian may close its
actually held command descriptor or record a direct-child wait; a replacement
never reconstructs, closes, or reports the dead guardian's anonymous pipe.

The first attempt manifest binds a fixed all-zero recovery genesis head. Every
later attempt's first durable record binds the exact previous actor epoch,
attempt-directory name, latest recovery-record raw SHA-256, and the unchanged
generation/v2-head target. The lifetime ledger independently anchors every
attempt and head: the manager's pre-launch record anchors a recovery-only
guardian, while the still-live admission guardian appends its permitted
live-recovery anchor without claiming a new launch. Replay follows this
cross-actor raw-hash chain and rejects deletion, reordering, a duplicate actor,
multiple successors, an unanchored attempt, or any generation/v2-head drift. A
crashed attempt remains an honest prefix; a successor never rewrites or appends
as the prior actor.

Recovery closure writes and syncs an alternative
`RECOVERED_TOMBSTONE_DURABLE` decision in the actor's recovery directory, syncs
the generation directory, moves the whole generation from `active/` to
`recovered/` with `RENAME_NOREPLACE`, syncs both parent directories, and
reobserves the exact recovered pathname. It never appends or fabricates a
normal-v1 state. A fully exact staging generation with a verified
`generation.jsonl` but no v2 head has the finite
`GENESIS_ABORT_RECOVERY_REQUIRED` disposition; its recovery records remain in
that generation and the terminal move is `staging/` to `recovered/` with the
same no-replace and parent-sync rules. Any other staging residue quarantines.
Normal state 18 closes only through `active/` to `closed/`; recovered closure
only through an exact `staging/` or `active/` to `recovered/` move; unsafe
generations move only through an intent-first transition to `quarantined/`.

Use one canonical JSON-line file per record rather than a mutable append tail.
Each bounded exact-shape record contains its schema, fixed-width sequence,
record type, prior and next states, previous-record raw SHA-256, generation
identity, birth and actor epochs, boot ID, admission/control/job generations,
operation digest, and record-type-specific exact evidence. The final filename
contains the sequence and recomputed raw digest.

Every record is persisted in this order:

1. create a unique temporary regular file relative to the held journal
   directory with `O_CREAT|O_EXCL|O_NOFOLLOW` and mode `0600`;
2. perform bounded full writes and read back the exact bytes;
3. `fsync` the file;
4. use `renameat2(..., RENAME_NOREPLACE)` to its write-once final name; and
5. `fsync` the journal directory before the governed external effect begins.

A generation directory is built and synced in staging, moved into `active/`
with `renameat2(..., RENAME_NOREPLACE)`, and followed by `fsync` of both the
staging and `active/` parent directories before cgroup creation. Closing moves
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
recovery lineage; no state is skipped or invented. A live birth guardian may
retain and record its actual parentage, pidfd, wait, and pipe observations while
recovering. A replacement recovery actor keeps all of those facts null. An
exact staging generation with no v2 head follows the genesis-abort rule above;
unknown identity or staging state quarantines rather than guessing whether an
effect began.

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
mode and old lifetime described above. The launch has the same bounded
pre-exec-syscall trace, positive exec stop, held-file/live-`/proc` binding,
pidfd, membership, and durable pre-release receipt as a normal launch. The
recovery guardian adopts that epoch, verifies the boot ID, delegated root,
cgroup2 mount, controllers, and subtree identities, and only then starts its
separate recovery-ledger attempt. A live birth guardian entering recovery
instead obtains and durably records its own fresh recovery actor before the
first recovery effect; it does not relaunch itself.

The recovery actor replays every exact v2 bundle chain and inner v1 chain and
compares known active/closed generations with actual cgroup entries.
Uncertainty about the delegated root permits a durable state-root quarantine
record but no delegated-root mutation. New admission remains blocked until all
incomplete known generations are reconciled.

For an incomplete same-boot generation with a still-exact delegated root,
recovery persists a recovery intent before every external effect. A live birth
guardian first closes only the command descriptor it still actually holds; a
replacement actor records no pipe operation or observation. The actor then
writes `1` to the control cgroup's `cgroup.kill`, writes `1` to the job cgroup's
`cgroup.kill`, observes control emptiness, writes `1` to the job cgroup's
`cgroup.kill` a second time to close the supervisor-to-job clone race, and
observes job emptiness through `cgroup.events populated 0`, exact empty
`cgroup.procs`, and `pids.current=0`. It then persists removal intent, removes
only the exact journal-bound names, reobserves absence, and durably records a
recovered tombstone. Completed kill writes and later emptiness observations are
distinct records. Replacement recovery keeps supervisor/candidate reap, exit
status, pipe history, and application result null.

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

No live G1.7 control, provider, benchmark, qualification, promotion, or
publication path ran for this checkpoint. The additive journal-bundle v2 and
generation manifest now exist only as pure authority-null contracts. The
lifetime/recovery-ledger v1 contracts, filesystem journal creation, sync and
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
