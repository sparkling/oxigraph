# ADR-0041: G1.7 private co-located build issuer and physical owner chain

- **Status**: Proposed
- **Date**: 2026-09-03
- Updated: 2026-09-05
- Deciders: Oxigraph parity programme
- Implementation status: partially implemented at the authority-null contract
  boundary. Documentation-only S0, the S1 source-absent evaluator, S2's pure
  private-build-issuer requirements contract, and Graph-V5 S3A's dormant
  private-issuer evaluator are complete. Execution
  request v2, the Cargo helper attestation and status protocol, containment v2,
  build owner v2, process evidence v3, and product owner v3 remain dormant or
  replay-only. No private co-located issuer, build owner v3, product owner v4,
  production build completion path, or physical G1.7 authority exists
- Current programme task: `task-1788638159292-7hkaf5`
  (`ADR-0041-G17-PRIVATE-BUILD-ISSUER-GRAPH-V5`), in progress
- Current completed evaluator task: Graph-V5 S3A
  `task-1788638011523-4c24e5` at `a5f2442f`; dormant source task S3B
  `task-1788638033847-mlvsbe` is pending
- Historical Graph-V4 programme task: `task-1788589424013-hx1i83`, cancelled
  and superseded after independent review found that it coupled the dormant
  evaluator to predecessor interfaces that do not yet exist
- Historical V2 programme task: `task-1788403413560-sedu3a`,
  cancelled and superseded
- Architecture-freeze task: `task-1788403444941-5l8jci`, complete; the exact
  historical V2 DAG is stored at
  `task-plans/adr-0041-evaluator-first-dag-v2-2026-09-03`
- The corrected current DAG is stored at
  `task-plans/adr-0041-private-build-issuer-graph-v5-2026-09-05`
- Authority-null contract evidence: S1 `task-1788403485637-t9wn40` completed
  at `ef50d492`; S2 `task-1788403489170-xl71j9` completed at `4f5b5c51`
- **Amends**:
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md)
- **Depends on**:
  [ADR-0037 — Durable containment statefs and manager protocol](0037-durable-containment-statefs-and-manager-protocol.md),
  [ADR-0038 — Native containment manager, guardian, and launch trampoline](0038-native-containment-manager-guardian-and-trampoline.md),
  [ADR-0039 — Delegated-host containment qualification and readiness](0039-delegated-host-containment-qualification-and-readiness.md),
  [ADR-0040 — Commit-capable containment decision and application-output release](0040-commit-capable-containment-decision-and-output-release.md)
- **Related**:
  [ADR-0034 — First-class exact new-file admission](0034-first-class-exact-new-file-admission.md),
  [ADR-0035 — Durable native containment guardian and crash recovery](0035-durable-native-containment-guardian-and-recovery.md),
  [ADR-0036 — Guardian-control pure ABI](0036-guardian-control-pure-abi.md)

## Context

ADR-0017 implements the repository-evolution and evidence-promotion harness,
including a fail-closed G1.7 control surface and a sequence of pure,
authority-null contracts. That implemented decision deliberately stops before
physical benchmark ownership:

- execution request v2 is structurally compatible with isolation policy v2,
  but reports `POLICY_V2_BOUND_PRIVATE_ISSUER_REQUIRED`, physical launch false,
  and binding null;
- the compile-only Cargo `execveat` helper attestation has no exact request,
  runtime argv, or runtime environment binding;
- the status-v1 and containment-v2 modules replay caller-supplied bytes and
  cannot prove writer, process, cgroup, or syscall origin;
- production source-workspace build begin and finish fail `MISSING` because no
  same-lifecycle owner can prove child closure and reap;
- build owner v2 reports only replayed supervision observations, while process
  evidence v3 is permanently bound to request v1 and containment v1; and
- product owner v3 consumes the legacy build-owner-v1/process-evidence-v2
  chain, not the successor request-v2 path.

Reinterpreting any of those frozen v1, v2, or v3 bytes as physical evidence
would turn serialized claims into process authority. Expanding implemented
ADR-0017 in place would also make its completed harness decision appear to own
a new privileged runtime. A separate Proposed amendment is therefore required.

The physical work must not create another filesystem, cgroup, process-parent,
or positive-effect stack. ADR-0037 owns the sole statefs policy and syscall
object. ADR-0038 owns native manager, guardian, trampoline, pidfd, cgroup, and
race-free held-image mechanics. ADR-0039 owns current-host qualification and
activation. ADR-0040 owns the byte-distinct durable `COMMIT`, at-most-once
attempt, ambiguity, and descriptor-bound output-release successor. Dependency
on those decisions conveys required mechanisms only; it grants no G1.7
authorization or evidence.

## Decision

Add one version-additive private G1.7 build-issuance chain after the existing
replay contracts. Preserve every predecessor schema, projection, artifact,
status, command, fixture, receipt, and error byte. In particular, request v2,
status v1, helper attestation v1, isolation policy v2, containment v2, build
owner v2, process evidence v3, product owner v3, qualification contract v7,
and both human decision phases remain unchanged.

The additive chain consists of:

1. an authority-null private-build-issuer requirements contract;
2. a co-located physical issuer that can exist only inside one live production
   source-workspace build lifecycle;
3. `oxigraph.g1.7-benchmark-build-owner/v3` and its v3 projection; and
4. `oxigraph.g1.7-benchmark-product-owner/v4` and its v4 projection.

The completed ADR-0036 C21 and programme-umbrella local boundary at commit
`c01b3c6a` made S1 `task-1788403485637-t9wn40` dependency-eligible. S1 then
froze its source-absent evaluator at `ef50d492`, and S2
`task-1788403489170-xl71j9` implemented the pure requirements contract at
`4f5b5c51`. That contract freezes vocabulary, bounds, descriptor roles,
ordering, failure precedence, required dependency identities, and nonclaims;
it opens no descriptor, launches no process, mutates no cgroup or filesystem,
invokes no callback, and accepts no ambient authority. Its passing replay is
not a build owner.

Graph-V5 S3A `task-1788638011523-4c24e5` depended only on completed S2,
completed ADR-0037 S7 `task-1788573342748-wln111`, and completed ADR-0038 S3 V3
`task-1788589313411-vm7pg0`. It froze the dormant source-absent evaluator at
`a5f2442f`; its production candidate remains absent, readiness remains
unavailable, and the three later host-validation cases are non-executing
TODOs. S3B `task-1788638033847-mlvsbe` may now add only the dormant
authority-null source. Graph-V5 S4A `task-1788638038970-05pyb8` is a distinct
evaluator-amendment task that cannot start until the exact ADR-0039 and
ADR-0040 successor interfaces exist; S4B `task-1788638043966-3guruj` remains a
separately authorized host-validation gate. This split prevents the current
evaluator from guessing absent receipt fields or implying host authority.

The physical issuer, build owner v3, and product owner v4 remain unavailable
until their exact predecessor interfaces exist. This ADR does not guess or
freeze fields for absent ADR-0037 through ADR-0040 receipts. A source-absent
evaluator may freeze those fields only after it can consume independently
reviewed, exact predecessor interfaces.

### Single native and durable-effect stack

The issuer invokes only one exact, qualified ADR-0038/ADR-0040 adapter and
commit/output primitive. It does not call ADR-0037's statefs oracle or object,
or ADR-0038's manager, guardian, trampoline, wait, or cgroup interfaces
directly. Those layers and their ownership remain encapsulated behind the
adapter. Positive Cargo execution and release of any target bytes additionally
require the current same-host, same-boot, exact-artifact ADR-0040 successor
qualification and receipt-bound activation. The predecessor cancel-only
ADR-0039 receipt is required but is not sufficient.

ADR-0040's application-receipt-v7 projection is not a G1.7 owner receipt and
must not be relabelled as one. ADR-0041 consumes only a separately exposed,
authority-null physical commit/output primitive. If ADR-0040 cannot expose
that primitive without changing its frozen contract, positive ADR-0041 work
stays blocked until an explicit ADR-0040 amendment or a separately ratified
shared primitive exists.

No caller may inject process mechanics, a spawn function, filesystem or cgroup
callbacks, an FD map, a `captureMode`, a status observation, a reap claim, or a
serialized substitute for a qualified adapter. The production lifecycle
resolves the exact qualified implementation internally.

### Co-located private capability

One production entrypoint owns the complete transition from a ready product
source workspace through build-owner-v3 issuance. It must retain the source
workspace's private live capability and perform, in one non-transferable
lifecycle:

1. production build begin and terminal workspace revalidation;
2. exact execution-request-v2 construction;
3. held-descriptor preparation and alias exclusion;
4. qualified durable `COMMIT` and helper-image execution;
5. bounded status, stdout, and stderr collection;
6. consumption of the guardian-owned exclusive direct-child pidfd wait and
   reap result;
7. complete delegated-cgroup quiescence;
8. held target ancestry, metadata, and ELF verification;
9. production workspace finish; and
10. canonical build-owner-v3 issuance.

The successful physical-origin value is an opaque, non-serializable,
single-use capability branded by the same issuer instance. A plain object,
canonical JSON document, digest match, proxy, accessor, prototype lookalike,
cross-run capability, or caller label cannot reproduce it. Serialization may
record the observations needed for independent replay, but replay never
reconstructs the private capability or proves that a process ran.

### Exact descriptor and image boundary

The issuer consumes the frozen isolation-v2 map unchanged:

| FD or role | Child/helper disposition      | Cargo-image disposition   |
| ---------- | ----------------------------- | ------------------------- |
| 0          | read-only `/dev/null` stdin   | retained as FD 0          |
| 1          | Cargo stdout pipe writer      | retained as FD 1          |
| 2          | Cargo stderr pipe writer      | retained as FD 2          |
| 3          | held workspace-root directory | retained as FD 3          |
| 4          | held source directory         | retained as FD 4          |
| 5          | held target directory         | retained as FD 5          |
| 6          | held Cargo executable         | `FD_CLOEXEC` before Cargo |
| 7          | sole status-pipe writer       | `FD_CLOEXEC` before Cargo |
| 8          | held helper executable        | `FD_CLOEXEC` before Cargo |

The helper image has exactly FDs 0 through 8. It closes every descriptor at or
above 9 with the frozen fail-closed `close_range` rule and no fallback loop.
The Cargo image has exactly FDs 0 through 5. Child descriptors are pairwise
distinct open-file descriptions with the required types, access modes,
ancestry, and pipe relationships.

The status reader, held cgroup directory, and direct-child pidfd remain
parent-only and have no caller-selected fixed numbers. They cannot alias a
child descriptor. Request v2 binds exact Cargo argv including `argv0`, exact
environment, workspace/source/target identity, Cargo identity, limits, helper
implementation/logical names, the helper-attestation schema, initial-launch
requirements, and the status/isolation requirement digests. It does not bind a
concrete helper artifact. Before launch, the new issuer must separately verify
and cross-bind the request-v2 identity, helper-attestation identity, and held
FD-8 helper identity.

### Status, output, reap, and quiescence

The issuer preserves status-v1's 4,096-byte, two-frame, 2,000-ms boundary and
its only legal terminal sequences: `READY -> EOF`, pre-ready `ERROR -> EOF`,
and `READY -> ERROR(execveat) -> EOF`. Reserved helper exits 240 through 245,
the reported stage, `errno`, process exit, signal, writer closure, and final EOF
must agree exactly. Status replay alone does not prove `execveat` success.

Cargo stdout and stderr remain distinct, bounded streams. Their close and EOF
observations, Cargo JSONL interpretation, process exit, pidfd readability,
exclusive `waitid(P_PIDFD)`, direct-child reap, and cgroup observations remain
separate facts. Quiescence requires all of `cgroup.procs` empty,
`cgroup.events` reporting `populated 0`, and `pids.current` reporting zero.
None can be inferred from another, a numeric PID, a timeout, or a removed
pathname.

The verified target is read through its retained ancestry and held descriptor.
A path lookup, metadata-only match, caller-provided bytes, or post-cleanup
observation cannot establish the target ELF. No target byte, build owner, or
workspace-completion result crosses the private boundary until status, streams,
reap, quiescence, target identity, and durable lifecycle closure all succeed.

### Failure precedence and retention

The physical entrypoint applies this precedence:

1. authorization/readiness and exact dependency attestations;
2. source/workspace revalidation;
3. request-v2 construction;
4. held-FD type, access, alias, and image-map validation;
5. durable `COMMIT` plus positive helper exec-image proof;
6. status terminal state and reserved-exit agreement;
7. Cargo exit, stream closure/EOF, bounds, and JSONL validity;
8. exclusive pidfd wait and direct-child reap;
9. complete cgroup quiescence;
10. held target ancestry and ELF validation;
11. production workspace finish; and
12. canonical build-owner-v3 issuance.

A definite failure before any child can exist is a no-child `FAIL`. A validly
reaped nonzero process, helper error, protocol error, or semantic output failure
is `FAIL`. Any prefix in which a child might exist but direct-child reap and
complete cgroup quiescence are not both proved is
`INCONCLUSIVE_RETAINED`. That result dominates cleanup and success: the live
workspace, cgroup, descriptors, handles, and evidence remain retained, no
owner is issued, and no retry or destructive cleanup may erase the ambiguity.
After durable `COMMIT`, the generation permits no retry or relaunch for any
outcome, including a definite helper, no-child, or process failure. Cleanup
uncertainty is exactly `INCONCLUSIVE_RETAINED`; it releases no target or owner
and retains every required state and handle.

### Build owner v3 and product owner v4

Build owner v3 accepts only the issuer's live private capability and emits a
new canonical artifact for independent replay. It cross-binds the exact source
projection, request v2, helper attestation, status transcript, isolation and
containment requirements, qualified native/durable-effect identities, raw
stdout and stderr, process outcome, direct reap, cgroup quiescence, and held
target ELF. It never trusts build-owner-v2 `captureMode` as provenance and does
not make process-evidence-v3 accept request v2.

Physical observations may be true in the v3 artifact, but its `binding`
remains null and `finalDecisionEligible` remains false. The additive authority
object is a complete false superset covering build, launch, helper, Cargo,
containment, native-process execution, native observation, physical issuance,
cleanup, control, qualification, receipt, promotion, publication, provider,
and Router quality. True observations are facts, not authorization. Replaying
the artifact verifies consistency and exact origin bindings; it does not
recreate physical origin.

Product owner v4 consumes exactly four distinct build-owner-v3 artifacts in
the frozen build-role order. It binds the existing source, platform/toolchain,
execution-plan, and authorization bytes, rejects role swaps and cross-run
substitution, and requires distinct owner, workspace, target, process,
containment, and lifecycle generations. Its replay remains binding-null,
final-decision-ineligible, and authority-null. Product owner v3 remains
unchanged and replayable.

### Authorization and activation sequence

Documentation-only S0 architecture freeze is complete. C21 task
`task-1788204883871-l9tsh9` and ADR-0036 programme umbrella
`task-1788042241332-xafq11` are complete for the local documentation/ledger
boundary at commit `c01b3c6a`. S1 `task-1788403485637-t9wn40` and pure S2
`task-1788403489170-xl71j9` are complete. Graph-V5 S3A
`task-1788638011523-4c24e5` froze the dormant evaluator at `a5f2442f`; S3B
`task-1788638033847-mlvsbe` is the current authority-null source task. Its
evaluator scope keeps later host-validation cases non-executing and does not
guess absent receipt fields. S4A/S4B retain the dependency and authorization
split described above. Positive Cargo execution or output
crossing the boundary requires the current ADR-0039
prerequisite plus ADR-0040's distinct successor destructive qualification and
receipt-bound activation for the same host, boot, artifacts, state root,
delegated root, protocol, and implementation.

Even then, capability to run does not self-authorize a G1.7 build. ADR-0017's
existing two human phases remain controlling:

- Phase A may authorize only permanently non-promoting negative and A/A noise
  controls. The new owners may then emit and seal their raw control receipt.
- Phase B must separately bind that raw receipt, its observed signature, and
  exact G1.4b evidence before any subject or reference sample is produced.

An eventual `ACCEPT` still means only
`QUALIFIED_AWAITING_HUMAN_PROMOTION`. Promotion remains a separate human action.

## Owned files

This ADR owns these additive paths:

- `tools/engineering-harness/src/qualification/benchmark-private-build-issuer-v1-contract.mjs`;
- `tools/engineering-harness/src/qualification/benchmark-private-build-issuer-v1.mjs`;
- `tools/engineering-harness/src/qualification/benchmark-build-owner-v3-contract.mjs`;
- `tools/engineering-harness/src/qualification/benchmark-product-owner-v4-contract.mjs`;
- `tools/engineering-harness/test/g17-private-build-issuer-v1-contract.test.mjs`;
- `tools/engineering-harness/test/g17-private-build-issuer-v1.test.mjs`;
- `tools/engineering-harness/test/g17-benchmark-build-owner-v3-contract.test.mjs`;
- `tools/engineering-harness/test/g17-benchmark-product-owner-v4-contract.test.mjs`;
  and
- `tools/engineering-harness/test/support/g17-private-owner-v3-v4-fixtures.mjs`.

After the physical predecessor interfaces are ratified, this ADR may make only
the minimal additive production-lifecycle change in
`tools/engineering-harness/src/qualification/product-source-workspace.mjs`.
Its existing public production begin and finish functions remain fail-closed
unless and until an evaluator-first integration slice explicitly ratifies a new
co-located entrypoint. Test-only adapters and capabilities remain explicitly
branded and cannot authorize production.

This ADR does not own or modify request-v2, status-v1, helper-attestation-v1,
isolation-v2, containment-v2, build-owner-v2, process-evidence-v3,
product-owner-v3, their existing fixtures/tests, ADR-0037/ADR-0038 native or
statefs sources, runner dispatch, control protocol, contract-v7 bytes, command
or package registries, decisions, or expected results. Later activation of a
runner or command is a separate ADR-0017-governed evaluator-first slice.

## Acceptance boundary

Implementation requires:

- byte-exact predecessor compatibility and import-purity checks;
- exact export, schema, status, field-order, self-hash, bound, error-precedence,
  authority, and nonclaim evaluators for every additive serialized contract;
- an independently accepted source-absent RED before each GREEN source;
- all request/helper/isolation/containment/native/host/commit/output identities
  cross-bound with substitution, alias, reorder, replay, and lookalike
  negatives;
- every child and parent FD role, access mode, open-file-description
  distinction, `CLOEXEC`, close-range, argv, and environment mutation killed;
- every status/exit disagreement, partial frame, overflow, timeout, EOF fault,
  stream fault, pidfd/wait/reap fault, cgroup contradiction, target
  substitution, and cleanup ambiguity classified by the frozen precedence;
- four-build role/order, origin, generation-uniqueness, cross-run, and
  substitution controls for product owner v4;
- current-runtime and Node 20 focused plus complete non-G1.7 suites;
- independent contract/ownership, compatibility, and native security/mutation
  reviews; and
- explicit isolated-host and human authority before any live G1.7 control or
  sample.

MetaHarness score, genome, OIA, Darwin, GEPA, and other engineering diagnostics
remain advisory. Darwin or GEPA may tune engineering policy only; they cannot
edit this ADR, evaluators, expected results, thresholds, semantic truth, or
promotion criteria. Product behavior and exact application tests remain the
progress authority.

## Nonclaims and authority boundary

This decision and every pre-activation artifact grant no:

- self-authorization merely because a process can be executed;
- Phase A or Phase B approval;
- live G1.7 control, sample, benchmark, qualification, receipt, or promotion;
- production readiness or support for an unqualified host;
- substitution of an ADR-0039 host receipt for G1.7 owner evidence;
- G2.2 `COMMIT`, application-output, or application-receipt authority;
- Router or provider execution, publication, push, deployment, or external
  effect;
- crash, power-loss, filesystem-flush, same-UID, kernel, or malicious-host
  resistance beyond an explicitly qualified profile; or
- reinterpretation of any existing v1, v2, v3, or v7 byte.

Production readiness remains exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`. All current
G1.7 physical eligibility, binding, final-decision eligibility, control,
qualification, receipt, and promotion values remain null or false.

## Consequences

- G1.7 gains an explicit path from request v2 to independently replayable
  physical build and four-build product ownership without weakening legacy
  evidence.
- One private co-located capability prevents caller-supplied serialized claims
  from crossing the process-origin boundary.
- Reusing ADR-0037 through ADR-0040 avoids a second privileged native and
  durable-effect stack, at the cost of placing physical progress behind their
  exact closure.
- Ambiguous child, reap, quiescence, or cleanup outcomes retain resources and
  release no owner, making recovery cost visible rather than manufacturing
  success.
- The additional evaluator, mutation, native, host, and independent-review
  surface is substantial. Documentation-only S0, S1 RED, pure S2 GREEN, and
  Graph-V5 S3A's exact source-absent RED are complete. S3B is the current
  dormant source step, while host validation remains separately gated.

## Alternatives rejected

- **Extend ADR-0017 in place.** Its implemented status would blur the boundary
  between the completed harness and a new privileged runtime.
- **Make request v2 or process evidence v3 physically eligible.** That would
  reinterpret frozen structural or request-v1 bytes.
- **Trust build-owner-v2 `captureMode` or a serialized reap record.** A caller
  label or document cannot prove process origin, parentage, or exclusive wait.
- **Create a G1.7-specific statefs/cgroup/exec stack.** That would duplicate
  ADR-0037 through ADR-0040 and split ambiguity ownership.
- **Treat ADR-0039 qualification or ADR-0040 application receipts as G1.7
  evidence.** They are prerequisites with different claim scopes.
- **Clean up or retry an ambiguous child.** That could erase or duplicate an
  unresolved effect.
- **Let a passing harness score authorize live execution or promotion.** Scores
  are diagnostics; exact application evidence and human gates remain decisive.
