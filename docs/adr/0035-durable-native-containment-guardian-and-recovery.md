# ADR-0035: Durable native containment guardian and crash recovery

- **Status**: Proposed
- **Date**: 2026-08-29
- Deciders: Oxigraph parity programme
- Implementation status: partially implemented only as an unregistered pure
  contract. Commit `ab668ddd` adds local-only, authority-null journal
  construction and replay for the exact cancel-only transition graph. It does
  not write or recover a filesystem journal, run a native guardian, mutate a
  delegated cgroup, or execute the supervisor preflight, and it is deliberately
  absent from runtime, task-profile, and CLI registries. The next permitted
  implementation slice is the authority-null executable supervisor preflight;
  neither slice may activate production containment, G1.7, G2.2,
  qualification, promotion, or publication
- **Depends on**:
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0034 — First-class exact new-file admission](0034-first-class-exact-new-file-admission.md)
- **Related**:
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md)

## Context

ADR-0034 defines the exact task-contract v2 admission model and freezes its
implemented primitives, but its complete unregistered gate and candidate
containment path remain open and unavailable. The current containment owner is
a simulated lifecycle contract, the reviewed native supervisor is a dormant
compile-only artifact, and bootstrap v3 is a pure replay. None proves that the
reviewed executable ran, that live descriptors or cgroup state matched a
request, that the guardian durably chose a decision before sending it, or that
cleanup survived controller failure.

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

One stable guardian lifetime and its admissions use this topology:

```text
delegated-root/
  guardian-<guardian-epoch>/
  ctl-<control-generation>/
  job-<job-generation>/
```

The service-manager owner creates the guardian-lifetime cgroup, moves the
guardian into it, and removes it only after guardian termination and exact
empty-state observation. The stable guardian exclusively creates, configures,
kills, reconciles, and removes the per-admission `ctl` and `job` cgroups. The
supervisor receives only command input on FD 0, status output on FD 1, bounded
diagnostics on FD 2, the exact job-cgroup descriptor on FD 3, and the
already-declared retained files on FDs 4 through 17. A candidate never receives
FD 3 or writable cgroupfs visibility.

The guardian is the supervisor's stable direct parent. A controller may detach
or restart without transferring parentage. The guardian independently cancels
on controller loss and completes the bounded terminal sequence. If the guardian
itself dies, replacement recovery never reconstructs reap, exit-status, pipe,
or historical cleanup facts.

### Durable identities

The guardian obtains randomness through the kernel with no weak fallback and
binds these non-reusable values:

- a fresh guardian epoch after each exclusive state-root lock acquisition;
- a fresh admission generation and launch nonce;
- domain-separated control and job generations derived from the epoch and
  admission generation; and
- the current boot-ID digest.

The generation identity also binds the request and owner-request digests,
limits, delegated-root identity, exact cgroup names, launch-capsule raw and
projection digests, bootstrap and launch-requirement digests, and intended
supervisor executable identity. Birth and actor guardian epochs are separate;
a recovery actor cannot impersonate the process that created a generation.

Full generation values are used in names. Admission rejects a collision with
active, closed, or quarantined journal generations and with any existing
cgroup entry.

### Write-once journal

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

State-filesystem sync errors are terminal recovery requirements. Cgroupfs
writes make no `fsync` claim; they are established only by exact bounded
readback.

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

A future additive schema may introduce `COMMIT` only after its exact bytes and
all request, epoch, generation, and READY bindings are durably recorded and the
file plus directory syncs succeed. An ambiguous commit-pipe write permanently
invalidates application output; recovery never retransmits commit or reuses the
generation.

### Restart recovery

After acquiring the exclusive state-root lock, a replacement guardian first
verifies the held state-root identity read-only. If that identity is uncertain,
it records nothing and stops. Only after that check does it durably record a
fresh actor epoch, then verify the boot ID, delegated root, cgroup2 mount,
controllers, and subtree identities, replay every exact journal chain, and
compare known active/closed generations with actual cgroup entries. Uncertainty
about the delegated root permits a durable state-root quarantine record but no
delegated-root mutation. New admission remains blocked until all incomplete
known generations are reconciled.

For an incomplete same-boot generation with a still-exact delegated root,
recovery closes any reconstructed command path, kills the control cgroup, kills
the job cgroup, observes control emptiness, kills the job a second time to close
the supervisor-to-job clone race, observes job emptiness through
`cgroup.events`, exact empty `cgroup.procs`, and `pids.current=0`, removes only
the exact journal-bound names, and reobserves absence. The recovery record keeps
supervisor/candidate reap, exit status, and application result null.

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

Normal local tests may exercise the pure transition model, corrupt and
crash-prefix journal replay, private temporary-directory write/sync/rename
mechanics, disposable process pipe/descriptor behavior, deterministic native
compilation, and an executable preflight that performs no cgroup mutation.
These prove bounded contract and syscall behavior, not power-loss durability or
containment.

Actual delegation, cgroup creation/readback/kill/removal, guardian and
supervisor death injection, `clone3` placement, migration resistance, reboot,
and power-cut behavior require an explicit isolated delegated host or VM and
separate receipts. Those runs are not G1.7 and cannot activate production,
application receipts, task/profile registration, qualification, promotion, or
publication.

### Current implementation checkpoint

Commit `ab668ddd` implements only the pure journal boundary in
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

No live G1.7 control, provider, benchmark, qualification, promotion, or
publication path ran for this checkpoint. Filesystem creation, sync and
no-replace mechanics, native guardian/reaper execution, recovery mutation,
delegated-cgroup qualification, and executable `PREFLIGHT_READY` evidence all
remain unimplemented. Production readiness therefore remains exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`.

## Acceptance boundary

The implementation must prove:

- the dormant supervisor source/attestation, bootstrap-v3 bytes, schema-v1
  fixtures, registries, and production readiness remain byte-identical;
- journal construction, replay, and recovery reject every malformed, stale,
  reordered, duplicated, aliased, or ambiguous state and enumerate every
  allowed transition and terminal reason;
- every durable record uses write, file sync, no-replace rename, and directory
  sync before its governed effect, with injected failure before and after every
  boundary;
- controller loss with a live guardian cancels, drains, reaps, reconciles, and
  closes, while guardian loss never reconstructs direct-child reap authority;
- the new native supervisor is compiled twice from exact attested sources into
  byte-identical static Linux x86-64 executables and the old artifact is never
  executed;
- safe local execution proves only preflight framing, raw-capsule hash, FD
  structure, cancel-only terminal bytes, EOF, zero successful diagnostics,
  exit, and direct-child reap, while semantic/cgroup/authority facts remain
  null or false;
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
- **Signal persisted PIDs during recovery.** Numeric PID reuse is not an
  identity-bearing authority.
- **Treat cgroup emptiness as reap.** Quiescence and direct-child wait are
  independent facts.

## References

- [Linux cgroup v2 documentation](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)
- [Linux `pidfd_open(2)`](https://man7.org/linux/man-pages/man2/pidfd_open.2.html)
- [Linux `waitid(2)`](https://man7.org/linux/man-pages/man2/waitpid.2.html)
- [Linux `fsync(2)`](https://man7.org/linux/man-pages/man2/fsync.2.html)
- [Linux `renameat2(2)`](https://man7.org/linux/man-pages/man2/renameat2.2.html)
