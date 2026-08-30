# ADR-0038: Native containment manager, guardian, and launch trampoline

- **Status**: Proposed
- **Date**: 2026-08-30
- Updated: 2026-08-30
- Deciders: Oxigraph parity programme
- Implementation status: not implemented. No manager, guardian, trampoline, or
  physical native adapter source exists, and no such artifact is registered or
  eligible to own production effects
- **Depends on**:
  [ADR-0036 — Guardian-control pure ABI](0036-guardian-control-pure-abi.md),
  [ADR-0037 — Durable containment statefs and manager protocol](0037-durable-containment-statefs-and-manager-protocol.md)
- **Related**:
  [ADR-0034 — First-class exact new-file admission](0034-first-class-exact-new-file-admission.md),
  [ADR-0035 — Durable native containment guardian and crash recovery](0035-durable-native-containment-guardian-and-recovery.md),
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md)

## Context

The existing supervisor-v2 source is a frozen dormant predecessor and the
preflight-v4 execution copy proves only its bounded cancel-only fixture. Neither
is the stable guardian, the service-manager-facing manager, or the restricted
launch trampoline specified by ADR-0035. A physical implementation must
preserve those predecessor bytes while separating executable identity,
pre-exec behavior, process parentage, cgroup placement, descriptor ownership,
status EOF, pidfd readability, wait, and cgroup quiescence.

## Decision

Implement three small, separately attested static Linux x86-64 executables and
one unregistered native adapter after ADR-0036 and ADR-0037 close:

- the manager consumes the held roots and locked open description, persists the
  manager protocol, owns lifetime-cgroup allocation and removal, and launches
  admission or recovery guardians. It links the exact separately attested
  ADR-0037 statefs-syscalls object unchanged and invokes it only with requests
  emitted by `containment-guardian-statefs-v1`;
- the guardian adopts the exact control ABI, remains the supervisor's stable
  direct parent, owns only its generation-bound `ctl` and `job` cgroups, and
  persists only writer transitions permitted by ADR-0035 and ADR-0037; and
- the trampoline performs only the exact descriptor remaps and held-file
  `execveat(AT_EMPTY_PATH)` allowed before the positive exec stop.

The adapter is the service-manager-side boundary for held executable and root
descriptors. It is not registered by this ADR and cannot return verified
production readiness.

### Execution identity and release

The external owner opens the exact manager artifact and holds it through a
positive race-free exec event. The manager does the same for the guardian. At
each stop, the parent binds the held file to live `/proc/<pid>/exe` device,
inode, and independently read bytes. Release is forbidden until exact equality
and the corresponding durable receipt succeed.

The trampoline trace admits only the ADR-0035 descriptor remaps and final
`execveat`; filesystem, cgroup, signalling, forking, threading, networking, and
other mutation before the positive exec stop fail closed. Pathname execution,
post-release-only image checks, and source or ELF attestation without execution
evidence are insufficient.

The ADR-0036 admission report is a serialized claim, not proof that a received
right remained unchanged. Before any remap, exec, or transfer of control, the
physical protocol must close every controller-side sending alias and establish
that no retained mutable alias or pathname authority can invalidate the
observation at that boundary. After that handoff, the guardian must immediately
revalidate every received right's complete identity, content, and current
offset using offset-preserving reads. Closure, immutability, revalidation, and
the transition to consumption require explicit evidence and fail closed on any
gap or mismatch. The writable `childResult` may become mutable only after its
verified initial state has crossed that boundary and control has transferred to
the launched supervisor.

### Process and cgroup ownership

The manager uses the held lifetime-cgroup descriptor with one
`clone3(CLONE_INTO_CGROUP | CLONE_PIDFD)` launch and verifies exact membership
before release. It alone creates, configures, directly launches into, and
removes lifetime cgroups. Admission and recovery guardians never mutate their
lifetime cgroup and alone own the exact `ctl` and `job` names permitted by the
verified generation.

Every direct child uses waitable `SIGCHLD` parentage with one exclusive waiter.
Pidfd readability, pidfd HUP, process termination, status EOF, successful
`waitid(P_PIDFD)`, cgroup quiescence, and pathname absence remain distinct
observations. A persisted numeric PID is never a signalling or identity input.
A replacement process never reconstructs pipe, parentage, exit status, wait, or
reap facts.

Controller loss starts the exact cancel/recovery path and does not transfer a
live guardian to a replacement controller. Recovery-only guardians use the
separate ADR-0036 mode, cannot admit work, and reconcile only the plan selected
by branded ADR-0035 replay and current ADR-0037 inventory.

### Static artifact boundary

Each C source has its own immutable self-description and attestation module.
The attestation binds exact source bytes, compiler identity, complete argv and
environment recipe, repeated-build artifact bytes, ELF structure, hardening,
protocol requirements, and explicit nonclaims. Compiler availability or a
matching ELF is not compiler causality or proof that the artifact executed.

ADR-0037 exclusively owns
`containment-guardian-statefs-syscalls-v1.h`, its C source, request/result
protocol, six-operation vocabulary, object attestation, and statefs policy.
This ADR neither regenerates nor forks those bytes. The manager build consumes
the exact attested link-time object, binds its digest and unchanged exported
entrypoint into the manager attestation, and proves that the final ELF contains
that exact object without an alternate filesystem implementation. Its exclusive
implementation scope is process, cgroup, and exec mechanics. Changing the
object, compiling the production object with the test-only fault selector, or
adding another state-filesystem syscall path requires ADR-0037 review first.

## Owned files

This ADR owns these new sources:

- `tools/engineering-harness/src/candidate/containment-guardian-manager-v1.c`;
- `tools/engineering-harness/src/candidate/containment-guardian-v1.c`;
- `tools/engineering-harness/src/candidate/containment-guardian-trampoline-v1.c`;
- corresponding `containment-guardian-manager-attestation-v1.mjs`,
  `containment-guardian-attestation-v1.mjs`, and
  `containment-guardian-trampoline-attestation-v1.mjs`; and
- `tools/engineering-harness/src/candidate/containment-guardian-native-adapter-v1.mjs`.

It also owns matching candidate native fixture, attestation, manager, guardian,
trampoline, and fault tests under `tools/engineering-harness/test/`. It does not
own or modify ADR-0037's statefs-syscalls header, C source, attestation, or
tests, or the frozen supervisor-v2, supervisor preflight-v4, bootstrap-v3,
journal, lifetime, or recovery sources.

## Nonclaims and authority boundary

Source, compiler, ELF, replay, and safe local process tests do not alone prove:

- a classified persistent state filesystem or durable power-loss behavior;
- a correctly delegated production cgroup subtree, exclusive subtree mutation,
  controller availability, migration resistance, or reboot recovery;
- a production service-manager unit or current host qualification;
- application output, semantic capsule validation beyond the existing bounded
  preflight, `COMMIT`, or application receipt eligibility;
- general Linux, architecture, libc, kernel, container, NFS, or SMB support; or
- runtime registration, verified readiness, G1.7 execution, qualification,
  promotion, or publication.

The adapter remains unregistered, binding-null, final-decision-ineligible, and
authority-free until ADR-0039. Production readiness remains exactly
unavailable.

## Acceptance boundary

Implementation requires:

- exact source, self-description, compiler, recipe, and repeated byte-identical
  static Linux x86-64 artifacts with independently verified ELF hardening;
- exact unchanged linkage of ADR-0037's attested statefs-syscalls object and
  sole entrypoint, including rejection of a rebuilt, substituted, extended,
  fault-enabled, or second filesystem-syscall implementation;
- preservation of every predecessor source, fixture, requirements digest,
  registry entry, and readiness value;
- positive held manager and guardian exec stops, held/live image equality,
  durable pre-release receipts, and rejection of every release-before-proof,
  image substitution, stop loss, or `/proc` read failure;
- an exhaustive pre-exec syscall allowlist and adversarial trace that rejects
  any additional remap, close, filesystem, cgroup, signal, clone, fork, thread,
  network, or mutation action;
- exact normal and recovery FD inventories, raw epoch framing, controller
  closure, admission descriptor roles, and diagnostic/status bounds from
  ADR-0036;
- controller-side sending-alias closure, mutation exclusion, and immediate
  offset-preserving identity/content/offset revalidation for every admission
  right before remap, exec, or control transfer;
- exact manager/guardian writer and cgroup-role separation from ADR-0037;
- `clone3` initial placement, held target identity, membership readback, pidfd
  termination, HUP, exclusive `waitid(P_PIDFD)`, EOF, kill, quiescence, removal,
  and descriptor-close observations kept independent;
- death and fault injection across every pre-release and same-process recovery
  prefix, with unresolved outcomes retained rather than relabelled safe; and
- current and Node 20 focused plus complete explicit non-G1.7 suites and
  independent native, ABI, compatibility, and security review.

The ordinary local suite may compile and exercise non-delegating process paths.
Actual delegated-cgroup, reboot, power-cut, and production-unit execution is
reserved for ADR-0039's explicitly authorized isolated host or VM.

## Consequences

- The stable direct-parent and restartable-controller lifetimes become physical
  without conflating their authority.
- Exact executable provenance and actual execution evidence remain separate.
- The native trusted computing base is small but carries a substantial
  adversarial and fault-injection burden.
- No production readiness changes until external qualification succeeds.
