# ADR-0038: Native containment manager, guardian, and launch trampoline

- **Status**: Proposed
- **Date**: 2026-08-30
- Updated: 2026-09-05
- Deciders: Oxigraph parity programme
- Implementation status: the bounded S0 native sources and S1 authority-null
  receipt/replay candidate below are present. S2 adds a pure unregistered
  cancel/recovery execution-transcript model and isolated in-memory fixture.
  Neither candidate is an operational native adapter. The manager remains a
  fail-closed link-only service-manager child, and no artifact is registered or
  eligible to own production effects. Readiness remains exactly
  `{status: "unavailable", reason: "native-adapter-unavailable"}`
- S2 review note (2026-09-05): four independent findings were repaired across
  three review rounds, including the recovery/trace 64-item call-site bound and
  recursive trap-free exact-own-data validation; the repaired freeze requires
  fresh review and does not change this Proposed ADR's implementation or
  readiness authority.
- **Depends on**:
  [ADR-0036 — Guardian-control pure ABI](0036-guardian-control-pure-abi.md),
  [ADR-0037 — Durable containment statefs and manager protocol](0037-durable-containment-statefs-and-manager-protocol.md)
- **Related**:
  [ADR-0034 — First-class exact new-file admission](0034-first-class-exact-new-file-admission.md),
  [ADR-0035 — Durable native containment guardian and crash recovery](0035-durable-native-containment-guardian-and-recovery.md),
  [ADR-0040 — Commit-capable containment decision and application-output release](0040-commit-capable-containment-decision-and-output-release.md),
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
- their shared authority-null
  `containment-guardian-native-attestation-common-v1.mjs` verifier; and
- `tools/engineering-harness/src/candidate/containment-guardian-native-adapter-v1.mjs`.

It also owns matching candidate native fixture, attestation, manager, guardian,
trampoline, and fault tests under `tools/engineering-harness/test/`. It does not
own or modify ADR-0037's statefs-syscalls header, C source, attestation, or
tests, or the frozen supervisor-v2, supervisor preflight-v4, bootstrap-v3,
journal, lifetime, or recovery sources.

### 2026-09-05 S0 authority-null native candidate

Task `task-1788589260075-knemz9` starts from exact commit
`acd09b610864868f4cb5d22f369662be761c2c4f`. The evaluator-first RED was the
absence of the three native sources, corresponding attestations, and native
fixture. S0 adds only those ADR-0038-owned paths and this record. Direct
deterministic application tests are authoritative; attestation reports and
engineering-harness diagnostics do not establish physical-host or production
facts.

The three immutable native requirement projections and source identities are:

| Artifact       | Requirement SHA-256                                               | Source bytes | Source SHA-256                                                    |
| -------------- | ---------------------------------------------------------------- | -----------: | ---------------------------------------------------------------- |
| Manager child  | `ec91cb4740266fdf4dac278af25cc3713d8f6b657ffc32e826933b4c8637f31f` |        2,840 | `4dba252351003b14202f20490b17b55ac5abf011ab60bdd87024a3d207585137` |
| Guardian/reaper | `94c6b1bbf7330fae09b73da5948aab02577aae42b7e5506577c11b270a556071` |       18,627 | `93e87316a10d289ac537350bd2af314370f0324e3d5b130cfe9ba4f1760f8039` |
| Trampoline     | `7efd0ec2b8728304dcf320e8fc22113047d4702002a76f849f3f39528e73bd6a` |        5,828 | `2e4e39718673030ee26f9870eab03d0adda33d656d807c01226420b776dc955b` |

Each source embeds its canonical self-description exactly once. The exact
compiler is `/usr/bin/x86_64-linux-gnu-gcc-13`, 1,023,032 bytes at SHA-256
`1b99826121ae6682a634e5efe09bd3e3df58ce58e0b28f849114ab5b89139c26`.
Its 266-byte version output has SHA-256
`ae487f55927d605284a32711e4ecf6bc3be2bcd5a9de414ace0936264b741f85`.
The complete argument recipes are exported by the corresponding attestation
modules. Their environment is exactly `HOME=/nonexistent`, `LANG=C.UTF-8`,
`LC_ALL=C.UTF-8`, `PATH=/usr/bin:/bin`, `SOURCE_DATE_EPOCH=0`, and `TZ=UTC`.
Repeated exact builds produce these byte-identical static ELF64 artifacts:

| Artifact       | ELF bytes | ELF SHA-256                                                       |
| -------------- | --------: | ---------------------------------------------------------------- |
| Manager child  |    30,880 | `b297d888bce75128fc3f18c2454c753a159df97ab7fba8ce790af27540003e99` |
| Guardian/reaper |    10,872 | `b42663bd425f22e34998dd9d674849fd35673d7f3ad9e33d03d3cf09c12c4867` |
| Trampoline     |     9,848 | `2a19da84b079337d19b13b86d3dd6395e7517f038735c657b2956308dea87abc` |

All three are `ET_EXEC` AMD64 little-endian static artifacts with no
interpreter or dynamic segment, no writable-executable load, a non-executable
GNU stack, and exactly one self-description in a non-writable load. Source,
compiler, recipe, repeated bytes, and ELF inspection remain distinct evidence;
the attestation explicitly denies compiler causality, cross-host
reproducibility, live-process identity, and runtime syscall-closure claims.

The manager build links the exact ADR-0037 production object unchanged and the
manager neither forks its implementation nor invokes its entrypoint. The safe-
local fixture creates that exact object with ADR-0037's exported production
recipe and checks these unchanged identities before the manager link:

| ADR-0037 input | Bytes  | SHA-256                                                           |
| -------------- | -----: | ---------------------------------------------------------------- |
| Header         | pinned | `358abbcb75ee52e889f850e7d9a1eb68d6124af20963fbbf96e1f30c5ccd2a28` |
| Source         | pinned | `f0dd2f3d6944a1a81f31181ebec616669f2f8f21c52ad9d6799d1ba07ad63138` |
| Production object | 33,048 | `73980718aa506c536387515073b93f228a433d5969c3610f8a0c945602d97043` |

The unchanged StateFS build-requirements digest is
`fb198db797d462d97b35272820daa0ed84547621a877671882432afced000c70`.
The final manager ELF has exactly one
`oxigraph_containment_statefs_execute_v1` symbol and no alternate StateFS
entrypoint. Its own entry exits 125 without calling StateFS; connecting branded
ADR-0037 requests remains later manager/native-adapter work.

The S0 guardian implements only the bounded non-delegating mechanics that can
be exercised safely in an evaluator-owned temporary directory. Normal startup
admits exactly FDs 0 through 7 with the ADR-0036 roles; recovery-only startup
admits exactly FDs 0 through 6 with its distinct roles. It validates descriptor
kind, access mode and close-on-exec state, rejects aliased device/inode
identities, scans FDs through 1023 for extras, asserts an exclusive nonblocking
flock on the inherited state-root open description, validates the normal `AF_UNIX`
`SOCK_SEQPACKET` controller and `SO_PASSCRED`, and consumes exactly 32 raw epoch
bytes followed by EOF. Normal FD 7 must be a singleton regular read-only file
at offset zero. A recovery-only instance accepts no controller or supervisor
executable. The S0 flock assertion establishes possession after the call; it
does not prove pre-handoff lock continuity.

S0's evaluator-only one-byte normal control selects terminal teardown or an
injected post-clone failure. The latter proves that the still-live direct
parent sends `SIGKILL`, performs its one exclusive `wait4`, emits the bounded
`PROVISIONAL_CHILD_CLEANED` observation only afterward, and then closes the
known descriptors and status writer before exit. Recovery accepts only exact
`RECOVERY\n` plus EOF and follows the same terminal release. Status output is
bounded to 67 bytes and diagnostics to one fixed message of at most 22 bytes;
`SIGPIPE`, short epoch, trailing request, wrong controller kind, and an extra
descriptor fail closed. These S0 fixture messages are not substitutes for the
ADR-0036 canonical control frames, and `wait4` is not the later required
`clone3`/pidfd/`waitid(P_PIDFD)` proof.

The trampoline contains no parser or caller-selected mapping. It performs the
fixed 18 remaps from incoming FDs 32 through 49 to supervisor FDs 0 through 17,
marks held executable FD 18 close-on-exec, closes the range from 19 upward, and
calls only `execveat(18, "", ..., AT_EMPTY_PATH)`. Its production direct-syscall
surface is exactly `close`, `fcntl`, `exit_group`, `dup3`, `execveat`, and
`close_range`. A separately compiled evaluator-only selector kills each of the
20 pre-exec prefixes and never executes the target.

The focused S0 suite contains 22 direct tests covering exact identities,
repeated builds, immutable self-descriptions, static ELF structure, StateFS
linkage and substitution rejection, hostile attestation inputs, registry and
readiness preservation, normal/recovery startup, provisional-child cleanup,
terminal status EOF, initialization failures, all trampoline prefixes, and
the direct-syscall inventories. Integration requires those 22 plus ADR-0035
through ADR-0037's explicit 335-test non-G1.7 matrix to pass 357/357 on current
Node 24.14.1 and exact Node 20.20.2. No G1.7 command or delegated-cgroup run is
part of S0. At this S0 freeze, both exact matrices passed 357/357; the focused
22-test S0 suite also passed independently under both runtimes.

S0 does not implement the native adapter, the service-manager handoff, durable
manager protocol bridge, physical held-manager/guardian exec stops, live
`/proc/<pid>/exe` equality, controller-side admission-right alias closure and
content revalidation, `clone3(CLONE_INTO_CGROUP | CLONE_PIDFD)`, pidfd
readability/HUP, `waitid(P_PIDFD)`, delegated-cgroup mutation or readback,
power-loss recovery, production unit, canonical ADR-0036 control-wire bridge,
or complete ADR-0035/ADR-0037 lifetime/recovery execution. Those remain later
ADR-0038 slices and ADR-0039 qualification gates. The package, lockfile,
dependencies, submodules, predecessor sources, schemas, registries, binding,
authority, nonclaims, and readiness are unchanged.

### 2026-09-05 S1 authority-null launch-lifecycle evidence

Task `task-1788589281302-odp45f` starts from exact commit
`13586aeb4696c52ccc8574946e205003bdb027bd`. Its evaluator-first RED is the
absence of `containment-guardian-native-adapter-v1.mjs`. S1 adds that pure
receipt/replay verifier, three focused evaluator files, and two test-support
fixture files. It does not change or replace an S0 source or attestation and it
does not supply an operational service-manager adapter, registry binding, or
production effect path.

The candidate requirements SHA-256 is
`be25697d389f5b6023faebaf851095ed18d0d61501a755590f8c432bac809bba`.
It binds the exact S0 manager, guardian, and trampoline source, requirement,
and ELF identities above; the exact compiler and version identities; and the
unchanged ADR-0037 header, source, 33,048-byte production object, build-
requirements digest, and sole `oxigraph_containment_statefs_execute_v1`
entrypoint. S1 imports no filesystem, process, network, thread, or registry
authority. Its serialized reports retain binding `null`, every authority field
`false`, every physical fact `null`, and readiness exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`.

The receipt model fixes two chained pre-release rows. Sequence zero names the
trusted service-manager as the held-manager launch owner; sequence one names
the manager as the held-guardian launch owner and must carry sequence zero's
exact raw receipt digest. Those owner identities are explicit synthetic model
rows, not observations of the safe-local driver's identity. Both require
empty-path `execveat(AT_EMPTY_PATH)`, a one-syscall trace and a one-event event
trace scoped only from the initial ptrace stop through the positive exec event,
exact `PTRACE_EVENT_EXEC`, held/live device and inode equality, independently
read byte equality, and outcome-channel EOF. The model then fixes an ADR-0037
`PERSIST` request/result-before-release row. That row is
explicitly `synthetic-durable-model`, its physical durability is `null`, and
`releasePerformed` remains `false`; receipt replay is not filesystem or power-
loss evidence.

The placement row is also explicitly synthetic. It fixes an 88-byte `clone3`
request with `CLONE_INTO_CGROUP | CLONE_PIDFD`, `SIGCHLD`, no fallback, exact
child and pidfd return identities, and a one-member exact synthetic
`cgroup.procs` replay. The safe-local native fixture does not call `clone3` or
touch a cgroup. Its pidfd is obtained by `pidfd_open`, and the serialized
nonclaim says that this cannot prove the clone-returned pidfd or delegated
membership. Token disagreement, flag changes, membership drift, extra members,
fallback, and evidence-class substitution all reject before receipt creation.

The test-only C driver opens the exact S0 ELF read-only, may replace its
pathname with a decoy after that open, and enters the held file with
`execveat(AT_EMPTY_PATH)`. From the initial `SIGSTOP` through exec it observes
exactly syscall 322 and one `PTRACE_EVENT_EXEC`. While the child remains stopped
there, it matches the held and live `/proc/<pid>/exe` device, inode, size, and
independently read bytes, and observes the close-on-exec outcome channel at EOF.
It then detaches, observes the safe-local pidfd readable, consumes one exclusive
`waitid(P_PIDFD)`, and proves a second wait returns `ECHILD`. Both the unchanged
S0 manager and guardian exit 125; the installed pathname decoy exits 77 and is
not executed. The driver is not relabelled as the trusted service manager or
manager, so launch-owner/wait-owner equality is `null` in the safe-local row and
exists only in its explicit synthetic row.

This host does not report `POLLHUP` on that pidfd after the exclusive wait. S1
records the safe-local HUP observation as `0`, leaves the corresponding physical
fact `null`, and keeps the required HUP transition only as an exact
`synthetic-replay` row. The safe-local driver also has no independent guardian
status channel, so status EOF is `null` and exists only in the synthetic row.
Neither absence is relabelled as observed success.
Likewise, `parentage-lost` and `parentage-ambiguous` are valid unresolved receipt
states only when every pidfd, HUP, wait-owner, waitid, EOF, exit, and reap field
is `null`; neither state satisfies the pre-release model or proves reap.

The three focused S1 evaluators contain 20 tests. They cover the exact bindings,
canonical copy-on-read receipts, service-manager/manager launch ownership,
held-file pathname replacement, positive exec stop, bounded syscall and event
trace, live-image identity, synthetic durable and clone/membership replay,
safe-local pidfd readability and exclusive wait, honest HUP absence, unresolved
parentage, bounds, hostile objects, and authority/readiness tamper. Pathname
execution, live-image mismatch, wrong parent or reap owner, trace overrun or an
unlisted event, clone/pidfd/wait disagreement, membership drift, and smuggled
reap claims all fail closed. The focused suite passes 20/20 on current Node
24.14.1 and exact Node 20.20.2. Together with S0's 22 tests and ADR-0035 through
ADR-0037's unchanged 335-test explicit matrix, the non-G1.7 matrix passes
377/377 on both runtimes. No delegated-cgroup, G1.7, production-unit, reboot,
or power-loss action is part of S1.

The exact S1 file identities at freeze are:

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| `tools/engineering-harness/src/candidate/containment-guardian-native-adapter-v1.mjs` | 27,800 | `d8bc60a333608d7b94bce870c13facfe1e75fce878c46aca2b97b8dd78a4225a` |
| `tools/engineering-harness/test/candidate-containment-guardian-native-s1.test.mjs` | 10,660 | `0d2cd4f7a5c7b64e51e36e00e8bec6e4432e18b6eb251fdd26d4e40ecae5b4ef` |
| `tools/engineering-harness/test/candidate-containment-guardian-native-s1-faults.test.mjs` | 9,377 | `4bdff1fbf388cedf0558a7ca70c2e06334af2b19a982bcdb4e9775b25846cae6` |
| `tools/engineering-harness/test/candidate-containment-guardian-native-s1-native.test.mjs` | 3,980 | `103207db857dd80b2f191554a10b5f425b08ee60ae33137d6268f19c2d850cdf` |
| `tools/engineering-harness/test/support/candidate-containment-guardian-native-s1-driver.c` | 8,307 | `b94ad49bd224e892f7da0581889ffd29fee1c50d129bac5e435ebb2409159cf0` |
| `tools/engineering-harness/test/support/candidate-containment-guardian-native-s1-fixture.mjs` | 10,442 | `f8a7332e17dcd20a3328b85888477a3a5c7be9bd2a261f19cd441187c9518c12` |

The deterministic synthetic manager receipt is 4,074 bytes at SHA-256
`3d0e831aca589feb96d4b807ff12fa8562ab9d630f55dd3e5ed8d1780435f9ff`;
its chained guardian receipt is 4,050 bytes at SHA-256
`90d960dba1c57ef3676e199aa0385dfb91a3df5acb8ad01a7440149cfe5a2fa5`.
These identities are exact repository evidence only. The package, lockfile,
dependencies, submodules, predecessors, StateFS bytes, product/runtime
registries, schemas, authority, physical facts, binding, nonclaims, and
readiness remain unchanged.

### 2026-09-05 S2 authority-null cancel and recovery executor model

Task `task-1788589296466-4nzidh` starts from exact integrated-S1 commit
`0b6826077fa57d326dde9a434e93b7768c33c53e`. Its evaluator-first RED was the
sole absence of
`containment-guardian-recovery-executor-v1.mjs`. S2 adds that pure transcript
boundary, two focused evaluators, and one isolated in-memory fixture. The
candidate imports no filesystem, process, network, thread, cgroup, service-
manager, or registry authority and invokes no caller-supplied effect callback.

The S2 requirements SHA-256 is
`b6ad1ab0bdcae784e4cd348e1833015d8d693a1a94c7a2cc07971878c6a394a5`.
It binds the exact unchanged journal-v1, journal-v2, lifetime-v1, recovery-v1,
ADR-0037 StateFS-v1, and S1 native-adapter requirement digests. The latter
retains S1's exact S0 manager, guardian, trampoline, compiler, ELF, and StateFS
bindings. S2 neither replaces nor refreshes any predecessor identity.

The live plan is cancel-only and fixes one stable live-birth direct-parent
guardian model. After controller-command EOF and the durable cancel decision,
it orders cancel completion and supervisor done, then exact supervisor-status
EOF, exclusive `waitid(P_PIDFD)` reap, cleanup intent, ctl/job kill and
quiescence, ctl/job removal, guardian-owned descriptor closure, and finally
durable `CLOSED`. Every isolated synthetic effect refers to an earlier durable
intent. The plan contains no PID field or PID-signalling operation. The fixture
mutates only an in-memory object and the accepted execution status is explicitly
`SYNTHETIC_TRANSCRIPT_ACCEPTED`.

Recovery plans require a fresh `RECOVERY_ONLY_GUARDIAN` actor and accept
parentage only as lost, ambiguous, or not reconstructed. The exact recovery-v1
state sequence determines one of same-boot reconciliation, anchored-empty
genesis recovery, reboot interruption, quarantine, recovered-decision resume,
or quarantine-decision resume. A recovery-only actor may model the exact ctl/job
presence, two-phase kill, quiescence, removal, and recovered placement branches,
but must report old-supervisor command, status, pidfd, direct-wait, and reap
facts false. Any corresponding inherited state is rejected before plan
construction. Descriptor ownership and exclusive wait remain solely in the
live direct-child plan. Recovery never substitutes persisted PID signalling or
reconstructed parentage. Genesis and reboot anchored-empty plans first model
path absence.
Recovered and quarantined moves require an earlier durable decision, a
no-replace move, both source- and destination-parent syncs, and exact final-
location observation. Previously durable recovered/quarantine decisions are
adopted; a generation at the immutable decision source follows that exact move
sequence, while one already at the matching destination is only reobserved.

Every serialized authority field remains `false`, every physical fact remains
`null`, binding remains `null`, and readiness remains exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`. Durable intent,
controller loss, actor freshness, cgroup effects, EOF, descriptor state, pidfd
events, reap, moves, filesystem durability, and power-loss durability are all
explicit nonclaims outside the isolated synthetic model. S2 supplies no
delegated-cgroup, reboot, power-cut, production-unit, G1.7, G2.2,
qualification, promotion, publication, deployment, or production-readiness
result.

The focused S2 suite contains 19 tests. It covers exact predecessor bindings,
both live and recovery plans, every disposition, all three unresolved recovery
parentage forms, durable-intent ordering, isolated final states, and authority
nullness. It discriminates live direct-child descriptor/wait ownership from a
fresh recovery-only actor and fixes the complete status-EOF through durable-
`CLOSED` ordering. It rejects inherited command/status/pidfd/direct-wait/reap
facts, extra or aliased PID/parent/controller fields, stale actor kinds, state
omission/insertion/reorder/duplication, pathname substitution, PID signalling,
intent drift, trace overrun or unlisted events, false-positive outcomes,
missing or reordered EOF/reap/cleanup/quiescence/removal/descriptor/closed/
sync/location events, wrong move destinations, decision/adoption confusion,
and any binding, authority, physical-fact, or readiness upgrade. The focused
suite also proves that 65-item recovery-state and trace arrays fail at the
64-item bounds gate before accessor element processing. Recursive exact-own-
data validation covers the complete plan and the execution's embedded plan and
trace before derived canonical comparison; nested accessors and proxies are
rejected without invoking their getters or traps. It passes 19/19 on current
Node 24.14.1 and exact Node 20.20.2. Together with the unchanged
377-test explicit ADR-0035 through ADR-0038 S0/S1 non-G1.7 matrix, the exact
matrix passes 396/396 on both runtimes.

The exact additive S2 file identities at freeze are:

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| `tools/engineering-harness/src/candidate/containment-guardian-recovery-executor-v1.mjs` | 27,265 | `e1ccb7a436db91fb6589b6126b5279148c04d8bf435fa44d8ed73061c4149f2a` |
| `tools/engineering-harness/test/candidate-containment-guardian-recovery-executor-s2.test.mjs` | 11,769 | `40a65f7f8490b3375e58d81bce8b5ca5a08321b39e076b4bc3d169a256660f02` |
| `tools/engineering-harness/test/candidate-containment-guardian-recovery-executor-s2-faults.test.mjs` | 13,345 | `97f5ae868b5a423497e9c9f632b477d011af306bf429c51965b87a1c2b1ae2d5` |
| `tools/engineering-harness/test/support/candidate-containment-guardian-recovery-executor-s2-fixture.mjs` | 6,458 | `db0f949bb8ea6654cc8f9dd2f77f5914ca148fb8fdbb5fffea13341806f1b4ae` |

These hashes identify repository inputs only. S2 leaves package and lock bytes,
dependencies, submodules, all predecessor and ADR-0037 StateFS bytes,
product/runtime registries and schemas, authority, physical facts, binding,
nonclaims, and readiness unchanged.

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
