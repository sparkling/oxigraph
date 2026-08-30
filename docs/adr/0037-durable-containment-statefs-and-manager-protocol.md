# ADR-0037: Durable containment statefs and manager protocol

- **Status**: Proposed
- **Date**: 2026-08-30
- Updated: 2026-08-30
- Deciders: Oxigraph parity programme
- Implementation status: not implemented. No filesystem-backed guardian state
  owner or manager-protocol module exists, and production containment remains
  unavailable
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

Introduce two separately testable boundaries after ADR-0036 closes:

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
one of these six operations:

- `LOCK_EX_NB`;
- `INVENTORY`;
- `PERSIST_NOREPLACE`;
- `MKDIR_SYNC`;
- `MOVE_NOREPLACE_SYNC`; or
- `TEMP_CLEANUP`.

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

Every immutable manifest, bundle, lifetime record, recovery record, result, or
move marker follows one physical sequence: create an exact private temporary
regular file with no following, write the complete bytes, sync the file, install
the final name without replacement, and sync the containing directory before
the governed effect. Directory creation and lifecycle moves likewise sync the
required source and destination parents in their ratified order. Existing final
names are verified, never overwritten or treated as idempotent without exact
byte equality and the applicable predecessor proof.

Attempt creation preserves ADR-0035's exact ordering: lifetime anchor durable,
attempt directory created, recovery parent synced, then record-1 temporary-file
persistence. Only the exact pre-temporary-file absent or present-empty outcomes
may become anchored-empty; residue cannot be laundered into an empty attempt.

### Manager protocol

The manager protocol consumes a fresh raw epoch exactly once, binds its digest
to the lifetime ledger before any effect, and keeps manager, admission guardian,
and recovery actors distinct. It admits only the writer transitions and crash
prefixes in ADR-0035's
[guardian-lifetime lineage](0035-durable-native-containment-guardian-and-recovery.md#guardian-lifetime-lineage).
It never infers guardian initialization, liveness, status, parentage, reap, or
cleanup from a PID, cgroup name, directory, or serialized ledger.

The protocol owns the deterministic response to lock contention, partial
launch, definite no-child launch failure, manager death, guardian death,
recovery-actor failure, bounded retry, state-18 close, and proved reboot. A
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

Local execution can prove the exact syscalls invoked and the current bytes and
metadata observed through held descriptors. It does not by itself prove:

- crash, power-loss, storage-device, filesystem-flush, or remote-filesystem
  durability;
- historical receipt-last ordering reconstructed only from final files;
- state-root provenance, service-manager identity, epoch randomness, guardian
  execution, or actor continuity;
- delegated-cgroup identity or mutation, process placement, signalling,
  descriptor ownership, pidfd ownership, wait authority, exit status, or reap;
- application output, `COMMIT`, semantic qualification, or product progress; or
- production registration, G1.7 execution, qualification, promotion, or
  publication.

The modules are not a general filesystem transaction library. The initial
profile excludes NFS, SMB, unclassified filesystems, caller-selected roots, and
same-UID tamper-resistance claims. Production readiness remains unchanged.

## Acceptance boundary

Implementation requires:

- exact held-root identity, owner/mode/link/type, no-follow, same-filesystem,
  six-directory, generation-uniqueness, and bounded-residue controls before any
  writer action;
- duplicate-manager and lock-loss controls with no fallback lock pathname;
- evaluator-owned operation plans and independently observed syscall receipts;
- an exact separately attested header, C source, compiler/recipe, repeated
  byte-identical link-time object, fixed entrypoint, six-operation request
  enum, and bounded last-step/failed-step/`errno`/observation result;
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
  mutable-buffer, Proxy, accessor, and over-count/over-byte rejection;
- unchanged ADR-0035 bytes, requirements digests, brands, authority and
  nonclaims, plus unchanged registries and production readiness; and
- focused and complete explicit non-G1.7 suites on current Node and Node 20,
  followed by independent filesystem, contract, compatibility, and security
  review.

Passing this boundary permits native implementation work under ADR-0038. It is
not delegated-host qualification.

## Consequences

- Filesystem durability ordering becomes independently fault-testable.
- Manager recovery cannot silently acquire guardian process authority.
- Native code can consume one finite manager/statefs protocol instead of
  embedding recovery policy.
- Real crash, reboot, power-cut, and delegation evidence remains a later gate.
