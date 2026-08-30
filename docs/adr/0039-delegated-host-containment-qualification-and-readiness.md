# ADR-0039: Delegated-host containment qualification and readiness

- **Status**: Proposed
- **Date**: 2026-08-30
- Updated: 2026-08-30
- Deciders: Oxigraph parity programme
- Implementation status: not implemented. No delegated-host qualification
  contract, current physical receipt, native adapter registration, or readiness
  transition exists
- **Depends on**:
  [ADR-0034 — First-class exact new-file admission](0034-first-class-exact-new-file-admission.md),
  [ADR-0038 — Native containment manager, guardian, and launch trampoline](0038-native-containment-manager-guardian-and-trampoline.md)
- **Related**:
  [ADR-0035 — Durable native containment guardian and crash recovery](0035-durable-native-containment-guardian-and-recovery.md),
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md),
  [ADR-0019 — Unified egress, cancellation, and service claims](0019-unified-egress-cancellation-and-service-claims.md),
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0021 — Transaction-time SHACL validation](0021-transaction-time-shacl-validation.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md),
  [ADR-0023 — Statistics and bounded join planning](0023-statistics-and-bounded-join-planning.md),
  [ADR-0024 — Rebuildable derived indexes](0024-rebuildable-derived-indexes.md),
  [ADR-0025 — Explicit SERVICE federation](0025-explicit-service-federation.md)

## Context

ADRs 0035 through 0038 can freeze and locally exercise exact contracts,
filesystem sequencing, executable bytes, and native mechanics. They cannot
prove that a production host supplies the required cgroup delegation,
filesystem behavior, kernel interfaces, service-manager launch root,
permissions, reboot behavior, or power-loss durability. Making the candidate
owner report verified readiness from local tests or version strings would turn
assumptions into authority.

This qualification is also distinct from ADR-0022's product-facing liveness,
readiness, backup, and restore contract. It qualifies the engineering harness's
containment host; it does not make the RDF store operationally ready.

## Decision

Keep production containment readiness exactly
`{status:"unavailable",reason:"native-adapter-unavailable"}` until an explicitly
authorized isolated delegated host or VM passes one exact qualification
contract for the complete ADR-0035 through ADR-0038 physical graph.

The qualification contract binds the exact manager, guardian, trampoline,
supervisor, adapter, pure-contract requirements, state-root identity and
filesystem profile, kernel and architecture profile, cgroup2 mount and
namespace, delegated-root identity, controller and permission observations,
service-manager launch configuration, test inventory, and raw receipts. A
kernel version string, administrator assertion, earlier receipt, copied
artifact, or replay on a different host is insufficient.

### Delegated-host gate

The first profile is limited to the Linux x86-64 baseline and exact feature
probes specified by ADR-0035's
[Linux feature and delegation gate](0035-durable-native-containment-guardian-and-recovery.md#linux-feature-and-delegation-gate).
It must prove ordinary domain cgroups, the exact process-empty delegated parent,
required controller state, `clone3` placement, pidfds, exclusive wait,
`cgroup.kill`, quiescence, pathname removal, ownership and mode boundaries,
and prevention of unowned migration or process creation in the subtree.

The classified state filesystem must prove the local open-file-description lock
and held-directory operations used by ADR-0037. Crash, manager death, guardian
death, supervisor death, restart, reboot, and power-cut cases receive separate
write-once receipts. A profile that cannot execute a required destructive or
power-cycle control remains unqualified; it cannot weaken the requirement or
substitute a simulation.

Qualification runs are separate from G1.7. They cannot use G1.7 control,
benchmark, final-decision, qualification, or promotion authority, and their
receipts are not G1.7 receipts.

### Readiness and integration

Only after the exact physical gate and ADR-0034's complete schema-v2 admission
gate pass may a later implementation replace the fixed unavailable production
path with a receipt-bound verified native adapter. Readiness is current-state
and fail-closed: missing, stale, mismatched, corrupt, unsupported, revoked, or
unavailable host evidence returns unavailable or unproved and performs no
candidate work.

ADR-0034 owns and ratifies application-receipt-v7 construction, verification,
and replay; schema-v2 dispatch and reconstruction; the frozen v2 task profile;
command and CLI literals; and the early exact
`executionGate: "native-containment-qualification-v1"` paired with
`contractSchemaVersion: 2`. This ADR consumes those exact frozen bytes
unchanged. It owns only current-host qualification, receipt-to-host binding and
activation, and proof that the qualified path executed through the runtime.
Application receipts v1 through v6, schema-v1 task contracts, predecessor
registries, and legacy replay remain byte-compatible.

The ADR-0034 gate precedes `reconstruct-v2` workspace preparation. While
readiness is exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`, preflight,
run, and replay perform zero candidate/evaluator Git, submodule, process,
provider, `ACCEPT`, `REJECT`, application-receipt emission, or Router-quality
work. A later pre-execution check remains defense in depth. Qualification may
activate only an exact receipt-bound path that preserves both checks and
demonstrates path-executed runtime closure. Passing containment readiness
permits only the bounded candidate attempt allowed by the frozen protocol; it
does not accept a product change or mint Router quality.

The initially qualified protocol remains cancel-only. It rejects `COMMIT`, emits
no application output, and cannot admit G2.2 even after ADR-0034 and this ADR
close. G2.2 requires a separately ratified commit-capable successor, its own
frozen evaluator, and exact decision, receipt, and cleanup semantics.

## Owned files

This ADR owns these new qualification paths:

- `tools/engineering-harness/src/qualification/native-containment-guardian-host-contract.mjs`;
- `tools/engineering-harness/src/qualification/native-containment-guardian-host.mjs`;
- matching host-contract and explicitly host-gated tests under
  `tools/engineering-harness/test/`; and
- `tools/engineering-harness/qualification/containment-guardian-v1/contract.json`.

After qualification, it owns only the necessary binding and activation changes
in:

- `tools/engineering-harness/src/candidate/containment-owner-v2.mjs`;
- `tools/engineering-harness/src/candidate/sandbox-session-v2.mjs`.

ADR-0034 retains exclusive ownership of `reconstruct-v2`, application receipt
and admission, contract/preflight/programme dispatch, task profile, command
registry, CLI, package, and their focused v2 fixtures. Any qualification
receipt, readiness value, activation fixture, or change to the two paths above
must first be ratified with exact bytes and independent negative controls. This
ADR does not pre-authorize those future literals or revise ADR-0034's frozen
ones.

## Nonclaims and authority boundary

Before the full gate, every existing physical eligibility, final-decision
eligibility, binding, production-containment, qualification, promotion, and
publication field remains null or false. After an exact host qualifies,
containment evidence is scoped only to that bound host, boot/profile, artifact
set, state root, delegated root, and cancel-only protocol. It does not prove:

- `COMMIT`, application output, semantic correctness, application acceptance,
  or a product receipt;
- G1.7 control, benchmark, performance, noise, qualification, or promotion;
- transaction guarantees or completion of ADR-0018;
- ADR-0020 durable change delivery, ADR-0021 transaction-time SHACL,
  ADR-0022 backup/restore readiness, ADR-0023 statistics, ADR-0024 derived
  indexes, or ADR-0025 federation;
- support for another kernel, architecture, filesystem, cgroup topology,
  container boundary, service manager, NFS, SMB, or unqualified environment;
- reconstruction of historical parentage, pipe ownership, exit status, reap,
  or ambiguous effects after guardian loss; or
- publication authority.

ADR-0019's implemented egress, cancellation, and service-claim boundary remains
unchanged. Guardian controller-loss cancellation does not expand SERVICE or
remote-input claims. Closing ADR-0039 removes only the host-qualification and
activation blocker. ADR-0020 G2.2 remains blocked by the cancel-only protocol
until a separately ratified commit-capable successor closes; neither decision
implements or advances that product slice by itself.

## Acceptance boundary

The gate requires:

- every ADR-0035 acceptance item, every ADR-0036 control-ABI gate, every
  ADR-0037 statefs/manager gate, and every ADR-0038 native artifact gate;
- exact fail-closed feature probes for syscall, flag, cgroup2 mount, namespace,
  controller, UID/GID, modes, common-ancestor and destination permissions,
  directory operations, `cgroup.procs`, `cgroup.events`, `pids.current`,
  `cgroup.kill`, pidfd, wait, trace, and executable identity;
- real manager, guardian, supervisor, controller, descendant, and adapter fault
  injection before and after every intent, effect, observation, durable record,
  release, reap, move, removal, and close boundary;
- controller restart with a live guardian, guardian death without invented
  direct-child authority, same-boot recovery, one-through-four proved reboots,
  migration attempts, unexpected descendants, delegation revocation, unknown
  entries, timeouts, permission loss, and quarantine/operator-block behavior;
- isolated crash, reboot, and power-cut receipts for the exact classified
  filesystem profile and current-state verification after restart;
- exact receipt binding to all source, artifact, recipe, host, boot, root,
  contract, test, and result identities, with stale/cross-host/cross-boot/
  cross-artifact substitution controls;
- unchanged consumption of ADR-0034's exact application-receipt-v7,
  schema-v2 reconstruction, task-profile, command, CLI, package, early-gate,
  and focused-fixture bytes while v1 through v6 and schema-v1 fixtures remain
  byte-identical;
- exact current-host qualification binding plus path-executed runtime closure
  through the activated `containment-owner-v2` and `sandbox-session-v2` paths,
  with missing or invalid qualification failing at the early gate before
  reconstruction workspace preparation or any candidate/evaluator Git,
  submodule, process, provider, `ACCEPT`, `REJECT`, receipt-emission, or
  Router-quality work;
- focused host suites, current and Node 20 complete explicit non-G1.7 suites,
  source-only programme and ADR-graph verification, and independent native,
  filesystem, compatibility, security, and MetaHarness review; and
- a separate human decision before any later semantic qualification, promotion,
  or publication action.

No live G1.7 control, provider, benchmark, semantic qualification, promotion,
or publication is part of this gate.

## Consequences

- Production readiness becomes an exact current-host fact rather than a source
  or configuration assertion.
- Unsupported or drifted hosts fail closed without candidate execution.
- Destructive kernel and power-cycle testing requires dedicated infrastructure
  and separately controlled receipts.
- Successful cancel-only containment still grants no product or promotion
  authority.
