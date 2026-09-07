# ADR-0040: Commit-capable containment decision and application-output release

- **Status**: Proposed
- **Date**: 2026-09-03
- Updated: 2026-09-07
- Deciders: Oxigraph parity programme
- 2026-09-07 scope amendment: commit-capable containment remains unimplemented
  future work for the optional containment path. Under
  [ADR-0043](0043-delivery-recovery-and-proportional-release-boundary.md) it
  does not gate R1 or a directly implemented and natively tested product slice.
- Implementation status: not implemented. The predecessor containment protocol
  is deliberately cancel-only and production readiness remains exactly
  `{status: "unavailable", reason: "native-adapter-unavailable"}`
- Programme task: `task-1788394167226-fxk7od`
  (`CONTAINMENT-COMMIT-SUCCESSOR`)
- **Depends on**:
  [ADR-0034 — First-class exact new-file admission](0034-first-class-exact-new-file-admission.md),
  [ADR-0035 — Durable native containment guardian and crash recovery](0035-durable-native-containment-guardian-and-recovery.md),
  [ADR-0036 — Guardian-control pure ABI](0036-guardian-control-pure-abi.md),
  [ADR-0037 — Durable containment statefs and manager protocol](0037-durable-containment-statefs-and-manager-protocol.md),
  [ADR-0038 — Native containment manager, guardian, and launch trampoline](0038-native-containment-manager-guardian-and-trampoline.md),
  [ADR-0039 — Delegated-host containment qualification and readiness](0039-delegated-host-containment-qualification-and-readiness.md)
- **Related**:
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md)

## Context

ADR-0034 now implements and freezes exact schema-v2 new-file admission,
application receipt v7, and a hidden CLI/package surface. That surface stops at
the early unavailable gate. ADR-0035 through ADR-0039 separately specify the
durable guardian, state filesystem, native manager and supervisor, and
current-host qualification needed to activate containment.

The currently specified bootstrap is intentionally cancel-only. It can prove a
bounded preflight and reject work, but it cannot write a `COMMIT` decision,
launch an application after that decision, or return application output. Even a
fully qualified cancel-only implementation therefore cannot run G2.2's
candidate-created semantic-change module. Reinterpreting `CANCEL`-only bytes or
silently adding `COMMIT` to an existing schema would invalidate the evidence
boundary and make crash ambiguity indistinguishable from successful execution.

Here, `COMMIT` means only “authorize this exact contained application attempt.”
It does not mean that a candidate is accepted, that a Git commit is integrated,
that Router quality is recorded, or that any product or external artefact is
published.

## Decision

Add a separately versioned, additive commit-capable successor after the
cancel-only physical and host-qualification gates are green. Preserve every
predecessor contract, protocol, executable, fixture, and receipt byte. The new
successor must use a distinct task/profile identity, command namespace,
protocol schema, journal record family, executable attestation, qualification
profile, and receipt projection. No predecessor readiness receipt can activate
it.

### Exact decision authority

One immutable decision document authorizes exactly one generation. Its
canonical bytes bind at least:

- the schema-v2 task request and raw contract digest;
- the candidate/evaluator identity and launch-capsule digest;
- the manager, guardian, supervisor, host-qualification, boot, state-root, and
  delegated-cgroup identities;
- the exact executable, argv, environment, stdin, retained descriptors, output
  ceilings, wall/resource limits, and process-proof policy;
- the decision `COMMIT` or `CANCEL`, a fresh nonce, and a single-use generation;
  and
- the predecessor journal head and exact successor protocol identity.

The manager may request a decision, but the stable guardian is the sole writer
of the decision frame. It must durably append and sync the exact decision record
through ADR-0037's state-filesystem owner before writing any decision byte to
the supervisor. A `COMMIT` or `CANCEL` acknowledgement binds the exact decision
digest. A missing, duplicate, reordered, stale, mismatched, or partially
persisted decision fails closed.

### At-most-once execution and recovery

`COMMIT` authorizes one launch attempt; it is not an exactly-once claim. The
guardian must remain the supervisor's direct parent, retain the required pidfd
and wait authority, and drive the attempt through one finite terminal sequence.
No controller, manager restart, or recovery actor may manufacture a second
attempt from a durable `COMMIT`.

Recovery follows these rules:

1. Before a durable decision exists, recovery can only cancel and close the
   generation.
2. A durable `CANCEL` can only complete cancellation and cleanup.
3. After a durable `COMMIT`, the live original guardian may finish the exact
   attempt. If its send, acknowledgement, launch, output, reap, or terminal
   state is ambiguous, recovery quarantines the generation and releases no
   application output; it never retries or relabels the attempt.
4. A replacement process cannot claim the original guardian's direct-child
   wait authority. Numeric PID reuse, a reopened pidfd, or an observed empty
   cgroup does not repair missing parentage or outcome evidence.

Every external effect has an intent-before-effect record and a bounded terminal
record. Crash and power-loss controls must cover each boundary between durable
intent, decision send, acknowledgement, clone, exec, output closure, direct-
child reap, cgroup quiescence, and lifecycle-directory closure.

### Application output

The contained process may write only to exact pre-opened output descriptors and
bounded diagnostic pipes. Candidate-controlled paths cannot select an output
destination. The guardian and outer harness retain the descriptors, exact byte
ceilings, ownership, mode, link count, device/inode identity, and pre/post
content hashes needed by the frozen request.

Application output is released to the outer harness only after all of the
following are true:

- the exact `COMMIT` acknowledgement and positive exec-image proof are valid;
- stdout, stderr, outcome, and status streams reach their required terminal
  records and EOF without overflow or trailing data;
- the direct child is reaped with an admissible status and the complete cgroup
  is terminally empty;
- retained input, executable, and output identities still match;
- the output bytes satisfy the frozen worker schema and process-proof rules;
- the exact cleanup and lifecycle-journal terminal state is replayable; and
- application receipt v7 verification binds the same request, candidate,
  worker union, process proof, and output bytes.

Failure or uncertainty at any step releases no output and no receipt. An
otherwise valid output remains a private candidate artefact; it still requires
the ordinary deterministic reconstruction, verifier, application-receipt, and
human integration boundaries.

### Qualification and activation

ADR-0039 must gain a distinct destructive qualification profile for this
successor. Cancel-only host evidence is a prerequisite but is not sufficient.
The commit-capable profile must bind the exact host, boot, kernel, cgroup,
filesystem, executables, protocol, journal, and output-release implementation,
and must independently exercise clean success plus crash, restart, timeout,
overflow, descriptor substitution, stale decision, duplicate decision,
ambiguous acknowledgement, escaped descendant, and cleanup-failure controls.

Activation remains fail-closed and receipt-bound. Missing, stale, revoked,
mismatched, or incomplete successor qualification restores the fixed
unavailable result before candidate/evaluator Git, provider, or application
work. No development fixture, pure replay, generic MetaHarness score, or source
attestation can substitute for the destructive host profile.

## Acceptance boundary

Implementation requires:

- byte-exact predecessor compatibility and a distinct successor schema at every
  contract, command, protocol, journal, executable, receipt, and qualification
  boundary;
- exhaustive pure state-machine and mutation tests for every legal transition,
  illegal transition, decision mismatch, duplicate/replay, output fault, and
  terminal precedence;
- current-runtime and Node 20 focused and complete non-G1.7 harness matrices;
- native Linux tests proving descriptor ownership, race-free held-file exec,
  direct-child pidfd/waitid evidence, complete cgroup cleanup, and output
  containment;
- destructive crash, manager/guardian/supervisor death, restart, reboot, and
  power-cut controls on an explicitly authorized ADR-0039 host;
- exact application-receipt-v7 integration and independent replay without
  changing any v1-v6 byte;
- independent architecture, compatibility, security, recovery, and adversarial
  review; and
- an explicit later human decision before G2.2 product execution begins.

Passing this ADR closes only the commit-capable containment prerequisite. It
does not implement or accept G2.2 and grants no G1.7 control, benchmark,
semantic qualification, Router, product promotion, external publication, or
push authority.

## Consequences

- G2.2 gains an owned path from exact admission to one bounded contained
  application attempt without weakening cancel-only evidence.
- Durable decision-before-effect and at-most-once recovery make ambiguous
  execution visible instead of retrying it into duplicate effects.
- Exact descriptor-bound output prevents candidate-selected path publication.
- The additional protocol, journal, executable, qualification, and destructive
  test surface is substantial and must follow ADR-0035 through ADR-0039 rather
  than being folded into the dormant exact-create control.

## Alternatives rejected

- **Add `COMMIT` to the existing cancel-only schema.** This would reinterpret
  already frozen bytes and qualification evidence.
- **Treat a `COMMIT` send as successful execution.** An acknowledgement, exec,
  output, reap, and cleanup can each fail independently.
- **Retry after an ambiguous committed attempt.** That would turn at-most-once
  containment into unbounded duplicate effects.
- **Let the worker choose an output path.** Path selection would escape the
  exact descriptor and creation authority frozen by ADR-0034.
- **Use a source-only or generic harness score as activation evidence.** Neither
  proves the host, filesystem, cgroup, process-parentage, or power-loss facts.
- **Conflate contained `COMMIT` with product acceptance or publication.** The
  decision authorizes one attempt only; all later verification and human
  authority remain separate.
