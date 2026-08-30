# ADR-0036: Guardian-control pure ABI

- **Status**: Proposed
- **Date**: 2026-08-30
- Updated: 2026-08-30
- Deciders: Oxigraph parity programme
- Implementation status: not implemented. No guardian-control evaluator, source
  module, runtime registration, or physical owner exists. The current production
  containment readiness remains unavailable
- **Depends on**:
  [ADR-0035 — Durable native containment guardian and crash recovery](0035-durable-native-containment-guardian-and-recovery.md)
- **Related**:
  [ADR-0034 — First-class exact new-file admission](0034-first-class-exact-new-file-admission.md),
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md)

## Context

ADR-0035 requires one small control boundary before native manager or guardian
code may own an effect. It already fixes the normal and recovery-only descriptor
roles, the epoch framing, the controller-loss behavior, and the separation
between guardian admission and supervisor control. Implementing those rules
directly in native code without a frozen pure contract would make the first
physical implementation its own oracle.

This decision is narrower than the existing supervisor control-v2 reducer.
Guardian control covers manager-to-guardian initialization, controller-to-
guardian admission, status framing, and recovery-only startup. It does not
replace or reinterpret supervisor `START`, `PREFLIGHT_READY`, `COMMIT`, or
`CANCEL` semantics.

## Decision

Add an authority-null `containment-guardian-control-v1` pure module and an
independent evaluator before any filesystem-backed or native guardian owner.
The module freezes and validates the exact descriptor maps, frames, limits, and
finite failures already specified by ADR-0035's
[stable guardian and delegated topology](0035-durable-native-containment-guardian-and-recovery.md#stable-guardian-and-delegated-topology).
Those literals remain normatively owned by ADR-0035 and are referenced rather
than copied here.

The normal mode must validate the exact FD 0-through-7 inventory, including the
sole connected `AF_UNIX/SOCK_SEQPACKET` controller channel, bounded
`SCM_RIGHTS` admission roles, status and diagnostic writers, inherited locked
roots, raw epoch pipe, and held supervisor executable. The recovery-only mode
must validate the distinct exact FD 0-through-6 inventory and reject controller,
supervisor, admission, or extra descriptors. Both modes require exact access
modes, non-aliasing, bounded framing, a 32-byte raw epoch followed by EOF, and
fail-closed handling of short, trailing, malformed, or reordered input.

The pure reducer must make controller loss an explicit cancel/recovery input.
It must never convert transport closure into guardian, supervisor, cgroup,
journal, descriptor-ownership, or cleanup evidence. Recovery mode cannot admit
work, launch a supervisor, emit application output, or reuse a normal birth
actor.

Before source implementation, the evaluator must independently freeze the
complete named-export inventory, schemas, ordered vocabularies, numeric bounds,
requirements value and digest, authority, nonclaims, physical facts, and exact
whole outputs. Public outputs must be exact recursively frozen null-prototype
values; returned byte views must be copy-on-read. Counts and raw byte lengths
must be rejected before decoding, hashing, sorting, or aggregate allocation.
Hostile Proxies, accessors, sparse arrays, foreign-realm values, mutable buffers,
and branded lookalikes must fail without invoking untrusted traps.

The module accepts data only. It accepts no root pathname and no injectable
filesystem, socket, cgroup, process, clock, randomness, or execution callback.
Its brands prove only same-module construction and pairing, never physical
origin or authority.

## Owned files

This ADR owns only these new candidate and evaluator paths:

- `tools/engineering-harness/src/candidate/containment-guardian-control-v1.mjs`;
- `tools/engineering-harness/test/candidate-containment-guardian-control-v1.test.mjs`;
  and
- `tools/engineering-harness/test/candidate-containment-guardian-control-v1-adversarial.test.mjs`.

It may import shared exact-value helpers and frozen ADR-0035 pure boundaries. It
does not own or modify journal-v1, journal-v2, lifetime-v1, recovery-v1,
supervisor-control-v2, supervisor-preflight-v4, registries, readiness, or any
production runtime.

## Nonclaims and authority boundary

Creation or verification of a control value proves none of the following:

- socket creation, peer identity, message delivery, or actual `SCM_RIGHTS`
  transfer;
- descriptor origin, access mode, non-aliasing, ownership, closure, or lifetime
  in a process;
- epoch randomness, freshness, pipe origin, exact writer, or observed EOF;
- state-root locking, journal persistence or durability, cgroup state, process
  placement, execution, parentage, pidfd ownership, wait authority, or reap;
- guardian, manager, recovery, containment, application-result, or cleanup
  execution; or
- runtime registration, G1.7 execution, qualification, promotion, or
  publication.

All authority fields remain false, all physical facts remain null or false, and
production readiness remains exactly unchanged.

## Acceptance boundary

Implementation requires:

- an evaluator-owned RED suite before production source exists, followed by the
  smallest source that satisfies the frozen public surface;
- exact positive cases for both modes and every permitted frame prefix;
- exhaustive missing, extra, duplicated, aliased, wrong-kind, wrong-mode,
  wrong-direction, reordered, over-count, over-byte, short-epoch, trailing-byte,
  and missing-EOF controls;
- exact `SCM_RIGHTS` role/count controls and rejection of normal/recovery mode
  confusion;
- complete controller-close, explicit cancel, diagnostic, and terminal reducer
  transitions with no invented physical observation;
- bounds-first and trap-free adversarial validation, copy-on-read bytes, and
  recursive output freezing;
- byte-identical predecessor sources and fixtures, and unchanged registries and
  `{status: "unavailable", reason: "native-adapter-unavailable"}` readiness; and
- focused and complete explicit non-G1.7 suites on the current Node runtime and
  Node 20, followed by independent contract, compatibility, and security review.

Passing this boundary permits ADR-0037 work only. It grants no permission to
start a filesystem-backed manager or guardian owner.

## Consequences

- Native code receives an independently frozen transport and failure oracle.
- Normal admission and recovery startup cannot silently share descriptors or
  authority.
- A new exact-value contract and adversarial evaluator must be maintained.
- No production behavior changes at this stage.
