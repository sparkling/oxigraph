# Oxigraph engineering harness

This private package is the application-development control plane accepted by
ADR-0017. It is separate from `tools/metaharness`, which remains the immutable
semantic-qualification adapter.

The package requests current upstream `latest` dist-tags. Its committed npm
lock binds exact registry tarballs and SHA-512 integrity, and `.npmrc` disables
lifecycle scripts. Runtime publication and OpenRouter transport are forbidden.

Native provider processes use an attested role-specific timeout policy. The
architecture, critique, and review roles retain the ten-minute ceiling;
implementation and repair receive a bounded twenty minutes because patch
generation must synthesize and encode the complete frozen-source diff. The
task contract's aggregate wall ceiling may reduce, but never increase, those
limits. The selected value is bound into each tool-free task and the complete
ceiling map is bound into the committed control identity; unknown roles fail
before provider spawn. Canonical implementation and repair patches must also
pass Git's bounded parse-only `apply --numstat --whitespace=error` oracle before
the native invocation can be labelled `ACCEPT`; applicability to the frozen
evaluator remains the sealed reconstruction stage's authority. Same-host retry,
circuit-breaking, and cancellation remain unchanged.

[ADR-0034 — First-class exact new-file admission](../../docs/adr/0034-first-class-exact-new-file-admission.md) is now
partially implemented but deliberately unregistered. Commits `78b2cf99`
through `65fb0e7a` preserve every schema-v1 byte while adding the exact v2 path,
tree, contract, reconstruction, task-context, schema, patch-assembly, and
worker-output primitives. Commit `54a056e0` adds exact stdin capture and the
native worker-v2 boundary: provider, Codex schema, and Git bytes execute through
retained read-only descriptors whose bigint identity, timestamps, ownership,
mode, link count, size, and SHA-256 are verified before and after execution.
Direct-child reap and original-process-group quiescence are required before a
root or the sole runner admission can be released. The focused v1/v2 matrix
passes 112/112 and two independent audits returned GO for that partial scope.
Commits `faae3d28`, `5b980c08`, and `d07cfdfa` move v2 reconstruction onto
exact Git bytes, bind the raw task contract, and seal the opaque candidate.
Commit `11e72201` adds exact submodule materialization, the structural sandbox
host/worker protocol, one-shot verification/disposal, typed classification,
shared byte/build policy, and strict cleanup quarantine. Its related non-G1.7
regression matrix passed 128/128. Commit `f3a0c127` removes the later-path-bind
race for the exact eight-file ESM/launcher payload: private 0400 copies are
transported through ordered `--ro-bind-fd` mounts, verified before and after,
closed on proven cleanup, and retained on uncertainty. The expanded related
matrix passed 177/177. Commit `c2cdde16` adds the separate, dormant candidate
containment-owner lifecycle contract and makes it the fixed readiness source.
Its test-only owner binds one fresh exclusive generation to the exact request
and fixed cgroup-v2 limits, models clone3 initial placement plus pidfd poll and
waitid reap, kills and re-observes escaped descendants, parses bounded terminal
cgroup evidence, proves post-removal absence, and permanently retains pending or
late authority after a timeout or abort. The expanded related matrix passes
201/201; the Node 20 compatibility floor passes 34/34. Commit `23997c29` then
adds an exact canonical request/status replay contract and a freestanding
static Linux/x86-64 supervisor skeleton whose reviewed source defines only a
fail-closed exit-125 entry. Compile-only tests build it twice without execution
and attest the exact source, compiler, recipe, static ELF, embedded
self-description, requirements, and FD map. Returned wire artifacts are
copy-on-read, repeated
outputs are labelled only as supplied-byte equality, and every execution,
containment, receipt, qualification, and promotion authority remains false.
Commit `88b9d7e7` adds a separate successor FD-map v2 and pure launch/control
contract. Canonical argv/environment bytes, fourteen retained file identities,
collision-safe-remap requirements, exact dynamic-descriptor requirements for
18-23, bounded concurrent stdout/stderr-drain requirements, and child/pidfd
closure requirements are digest-bound. START verification independently
replays the exact capsule bytes; READY carries a null decision digest, while
later decision acknowledgements bind the exact COMMIT/CANCEL digest; replayed
physical facts remain null; and pre-commit cgroup cleanup stays guardian-owned. The
expanded related matrix now passes 237/237 on both the current Node runtime and
Node 20, and three independent reviews returned GO for this narrow dormant
scope.
Commit `7191ddde` adds a separate launch-capsule v2 protocol and cancel-only
bootstrap v2 protocol without registering either one. The capsule allocates
scratch/output/outcome/pidfd descriptors 18-25, gives child trace and stop
failures their own exact outcome phases, and requires a held
`PTRACE_EVENT_EXEC` image-identity check plus zero-byte EOF before execution is
reported. The bootstrap transfers the exact capsule bytes in-band between
`START` and `READY`, then admits only `CANCEL`, `CANCELLED_BEFORE_CLONE`, and
`SUPERVISOR_DONE`. Retained-file inventory is scoped to FDs 4-17; FDs 0-3,
global status-writer ownership, guardian cleanup, freshness, physical facts,
and final authority remain explicit future requirements or nonclaims. The two
focused files pass 11/11 and the expanded related non-G1.7 matrix passes
248/248 on both current Node and Node 20. Three independent adversarial and
compatibility reviews returned GO for this dormant boundary.

Commit `ab668ddd` adds the separate pure guardian-journal v1 contract without
registering or executing it. It freezes the exact 18-state cancel-only graph,
canonical projection and LF-bearing raw-record hashes, generation/birth-epoch/
optional-head replay anchors, state-specific operation/evidence bindings,
replay-only chain validation, distinct complete/prefix statuses, null physical
and durability facts, and all-false authority. Its focused tests pass 14/14,
the expanded related non-G1.7 matrix passes 262/262 on current Node and Node 20,
the clean committed-code identity control passes 2/2 on both runtimes, and
three independent contract, adversarial, and compatibility reviews returned GO
for only this bounded pure scope.

Commit `040f3343` adds the separate authority-null native preflight execution
fixture. On local Linux x86-64 it compiles the exact attested source into an
0500 execution copy, keeps a parent-held executable descriptor through READY,
observes exact child FDs 0-19 before preflight and FDs 0-17 at
`PREFLIGHT_READY`, and checks the exact three status frames, EOF, empty success
diagnostics, exit 124, Node close/post-reap behavior, and private-root cleanup.
Thirty returned descriptor, protocol, I/O, timeout, O_PATH, and diagnostic-sink
fault scenarios plus a synthetic fourth-frame control fail closed. The focused
suite passes 47/47 and the complete top-level non-G1.7 suite, excluding the
separate committed-clean identity control, passes 495/495 on current Node and
Node 20; the identity control passes 2/2 on both after commit. Two fresh
independent reviews are GO for this bounded scope. The fixture deliberately
does not claim pidfd/waitid reap, semantic retained-file validation, cgroup or
guardian durability, FD-6 execution binding, production containment, G1.7,
qualification, or promotion.

[ADR-0035 — Durable native containment guardian and crash recovery](../../docs/adr/0035-durable-native-containment-guardian-and-recovery.md)
now owns the Proposed stable guardian/reaper, intent-first write-once journal,
restart reconciliation, and executable cancel-only preflight architecture. Its
pure journal construction/replay contract and test-local executable preflight
fixture exist, but no ADR-0035 runtime, task-profile, or CLI implementation is
registered. Filesystem persistence, native guardian/reaper and recovery
mutation, delegated-cgroup evidence, and the physical native adapter remain
unimplemented, so the decision does not change the fixed
production-unavailable boundary.

[ADR-0036 — Guardian-control pure ABI](../../docs/adr/0036-guardian-control-pure-abi.md)
is also Proposed and source-hard-stopped. Commits `970c135b` and `05796367`
materialize, then independently repair, the evaluator-owned STATUS-wire oracle:
15 distinct STATUS records, four atomic two-record prefixes, exact construction
and inventory identities, and fresh 124-object graphs with zero shared
non-primitive references. The first version received an explicit NO-GO for
depending on its design registries and sharing references; the follow-up
derives directly from the requirements fixture's `legalSequences`. Two
independent post-repair reviews and root reproduction returned GO for only this
evaluator slice.

Commits `957237a3` and schema repair `54b40874` first froze the accepted static
evidence manifest. Integrated commit `358c19d0` (source commit `87d727bd`)
adds the private-lookup slice after independent semantic, runtime, and
real-mutation reviews returned unanimous GO for only this bounded evaluator
checkpoint. Integrated commit `d971bfa4` closes `indirectCalls` and
`reflectComputed` with `SEM-N061` through `SEM-N082`; integrated commit
`86320201` closes `bindingMemberWrites` with `SEM-N083` through `SEM-N092`.
The current manifest records exactly 69 foundation negatives, 92 semantic
negatives, 11 positives, and 17 commit-mutation IDs that are a subset of the
92 semantic IDs. Current negative evidence is therefore exactly
`161 = 69 + 92`. Against the semantic 330/11/200 targets, 238 negatives, zero
positives, and 183 commit mutations remain; those 183 are included within, not
additional to, the 238 semantic negatives. The final all-layer negative target
is exactly `399 = 69 + 330`.

Every one of the 172 static-manifest entries has the exact fields `id`, `name`,
`bucket`, `sourceSha256`, `astSha256`, `astNodeCount`, `expectedStage`, and
`expectedError`. The literal tables retain the full source and normalized-AST
hashes, AST node counts, rejection stages, and complete canonical errors
without prefix or assertion-payload truncation. AST normalization omits exactly
`end`, `loc`, `range`, `raw`, `sourceFile`, and `start`, then sorts object keys.
Only the deliberately unparsable `FOUNDATION-N008` has null AST evidence.

The exact schema
`oxigraph.candidate-containment-guardian-control-static-evidence-manifest/v1`
has SHA-256
`eb34893fe9502ba08706fde2ee442711e1f902de281e3aa41552a1ce98df60e0`.
Its ordered-control, ordered-semantic, bucket, foundation-name, positive-name,
and commit-ID projections have SHA-256 values respectively
`c26680e91a1a1da495af7c2684d73cc21368a8041d5f2ec29bea94a56900ba7b`,
`2571662ac051c5ab4746e4f8b39881d9446a9140a88e965a48f248b497e87405`,
`4b2934dad496999ce72939de0a0716457462077bb1d8695a3af5ff5a03a22080`,
`3064a09db3f937a55e3d0febeca0a2f41ea836bc394cc1259748b268f59f6ce5`,
`f73112c110a5ced50c3f64fcd53da66e022f20abbaef83ddb5be69d32390f420`,
and `cda7855dc809ea3c5fefea4cb8417aae203ebb805b97e93f55a8899284171f1c`.
Independent review first killed 14/15 manifest mutations and found the schema
name was self-compared; `54b40874` adds the literal schema and independent
schema-digest pins, after which 15/15 probes are killed. The accepted Ruflo
record is
`programme-evidence/adr0036-static-manifest-54b40874-2026-08-30`.

`SEM-N013` is an explicit source rewrite, not an evidence refresh. The former
unowned helper would now fail at private-lookup ownership before reaching its
intended private-read laundering rejection. It now uses the authorized
`verifyCandidateContainmentGuardianStatusFrameV1` /
`startupMetadata` / `startupProjection` triple and retains the exact
`estree-policy` error
`static gate: ESTree deepFreeze argument provenance`. Its source/AST/node pins
change from
`b4bc0847cbbd9b7f908f1abcd38b754f657952ae064dc489cc4b2d0e336b8329` /
`20450c27418578ab4a84626011816d8be65662f565d91aefa7a0e6427ba9cfce` /
1,162 to
`cbc214639b03132d01081ac7c6acb6535a1b049ff7bb7e83989ee9d77d9d5364` /
`179b90dc7f86d6790e60e5ebc2308386a6982e37e576447821eedee195fbe331` /
1,156.

The authorized function/store/key-parameter inventory is exactly:

- `initializeCandidateContainmentGuardianControlV1` /
  `startupMetadata` / `startupProjection`;
- `verifyCandidateContainmentGuardianStatusFrameV1` /
  `startupMetadata` / `startupProjection`;
- each of `createCandidateContainmentGuardianAdmissionInputV1`,
  `createCandidateContainmentGuardianCancelInputV1`,
  `createCandidateContainmentGuardianRecoveryRequestInputV1`,
  `createCandidateContainmentGuardianControllerClosedInputV1`,
  `createCandidateContainmentGuardianDiagnosticFailureInputV1`,
  `createCandidateContainmentGuardianRecoveryControlHandoffInputV1`,
  and `createCandidateContainmentGuardianStatusEofInputV1` is paired with
  `stateMetadata` / `currentState`;
- `reduceCandidateContainmentGuardianControlV1` /
  `stateMetadata` / `currentState`; and
- `reduceCandidateContainmentGuardianControlV1` /
  `inputMetadata` / `brandedInput`.

That is an exact 2/8/1 store split. One `has` plus one `get` per pair yields 22
distinct operations, distributed across `POS-P006` through `POS-P011` as
2/2/2/12/2/2. Both the parameter name and its resolved binding identity must
match, so same-named local shadows and non-parameter expressions are rejected.
The result lattice is exactly
`has = {kind: "immutable", freezable: true, tainted: false}` and
`get = {kind: "private-read", freezable: false, tainted: true}`.

The recursively frozen private-lookup receipt is a sibling of, not an extension
to, the static manifest. Its schema is
`oxigraph.candidate-containment-guardian-control-private-lookup-evidence/v1`.
Its schema, ordered-method, ordered-authorized-pair,
ordered-observed-operation, and receipt-without-projection-hashes SHA-256 values
are respectively
`5ca5d446d3357b0b43b6421e1cedae2b62f37f9e58135349c7a663ec48b42b47`,
`f0afdaedcb5432d380f9d18e533963f7dcdcff465c7b7864b89e72d09d235a01`,
`562ce95945ad0e110eb9c01866a44c5202f37f2d4381a8ac8d68d7bded28b1e1`,
`164ab5c6d611fa840804fb88d4e59035e897f9f72db97e8161ef52f92834ada7`,
and `c86485d7298cd768a4ceb254274c6b331a9fb6981a5ae73cd6fb6328d90bbd6b`.

The semantic buckets have target/current/remaining counts of
`protectedAliases` 12/12/0, `indirectCalls` 12/12/0, `reflectComputed`
12/12/0, `bindingMemberWrites` 14/14/0, `untrustedSinks` 24/9/15,
`rawEscapes` 12/5/7, `literalMisuse` 14/4/10, `scopeJoins` 18/4/14,
`nestedRecursion` 12/3/9, and `commitMutations` 200/17/183. The independent
mutation review killed 12/12 real evaluator mutations.
The distinct accepted integrated Ruflo evidence key is
`programme-evidence/adr0036-private-lookup-358c19d0-2026-08-30`.
The callee/receiver and binding/member-write checkpoints were independently
reviewed and stored as
`programme-evidence/adr0036-callee-receiver-d971bfa4-2026-08-30` and
`programme-evidence/adr0036-binding-writes-86320201-2026-08-30`.

The integrated checkpoint leaves import-only behavior at zero byte reads and
exactly three exports on each of the three runtimes. It preserves the exact
506-byte source hard stop
`ac601db2df0b54bd27076633f2af1db613ee488d737c8bb85bd371febdc71de7`
and exact 12,095-byte four-TODO tail
`3f58dc980e85a6d725a6c147c7d1f95d37e200197f84c292feaed9f4a5cd270c`.
Current Node 24.14.1, exact Node 20.0.0, and Node 20.20.2 all produce direct
10/9/0/1, main 15/8/1/6, and combined 25/17/1/7 test/pass/fail/TODO matrices.
The sole focused failure remains the deliberate absent-candidate sentinel, and
`npm audit` reports zero known vulnerabilities. The slice does not fix global
malformed-expression diagnostic precedence or execute actual runtime `WeakMap`
lookups. The remaining semantic and mutation quotas, candidate-connected
execution, absent production source, runtime registration, physical native
owner, and production readiness remain incomplete; readiness is still exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`.

This is evaluator evidence only. It makes no production, semantic
qualification, promotion, G1.7, publication, or task-profile claim.

### ADR-0036 C15 checkpoint — 2026-09-02

The source-hard-stop narrative above is the preserved historical C14 record.
C15 is integrated and GREEN through helper commit `41dd2508`, guardian/fixture
commit `23d37556`, and evaluator commit `4620dd92`. The live artifact identities
are:

- `containment-exact-v2.mjs`: 12,687 bytes, SHA-256
  `194fb41e523b334206e91b2dfda8894f5e661a3d034b7330e3e6bd549e4c744e`;
- `containment-guardian-control-v1.mjs`: 81,670 bytes, SHA-256
  `3b3af0e393ed2141a1623be324b20369231742f66bfd0f745b0307575fdc9718`;
- `0036-guardian-control-requirements-v1.json`: 14,230 bytes, raw SHA-256
  `4f4433ed7e74a6076154d19139ffe79f8cf4a8fab4dbf0f5808a36fddf46dbdd`
  and canonical-JSON SHA-256
  `7348640cbf1128447cea9af280e4c5eec4fbcdb5405055fa883a0c81cb462fe8`.

The committed v1 fixture path now advances the live C15 contract. Historical
C14 remains privately reconstructed in the evaluator at integrated commit
`c333f8c5`: exact-v2 was 10,833 bytes at
`2c9d075538da2b114d58a208a97c97fe97a0cf9f78f7558b24ebacdab54d5bc3`,
guardian-control was 81,189 bytes at
`505fc2ea12a197603f745fb4fdeebaf1f560d9054c0245f135aa20972104e54d`,
and the fixture was 14,213 bytes with raw/canonical hashes
`968d1d53a14657545685b991b843aed58b7ed4e6e3e43e149308f839ebfd1082` /
`0f244f7242eb40a615245a5eda77d5380e368f43a8382f27b3cdb5c1a387e499`.
The C14 direct/adversarial and main evaluator hashes were respectively
`53cbb652fe89a3efdeccaa47e80855dd06a4402eeb7bececa6c15f597a529fc1`
and `58ff5e7f94a384a1e537b34cb042a0d4627f695389eb44f81c23cec08e727c27`;
all three runtimes passed direct 11 and main 15 with zero failures and three
TODOs.

The hostile-input RED at `e1e8e4ce` passed direct 11 and recorded main 15 pass,
one expected failure, and two TODO because `CONTROL_SHAPE` observed
`CONTROL_BOUNDS`. Launch RED `a3d57a38` kept direct 11 and recorded main 19
total / 15 pass / two expected failures / two TODO; the added control expected
`CONTROL_BINDING` and observed the predecessor error. Final `4620dd92` passes on
current Node 24.14.1, exact Node 20.0.0, and Node 20.20.2 with direct 11/11,
main 19 total / 17 pass / zero fail / two TODO, combined 30 total / 28 pass /
zero fail / two TODO, helper 20/20, and ADR verifier 1/1. The final main and
adversarial evaluator SHA-256 values are
`141dc5940080ce383b3de8f9f857243e9316fb272597d80a58999cd22862cedf`
and `86dc511d5188d95586aead3834484d552da02af2e4bcca55b8a98fedf03896ce`.
Independent review returned APPROVE for this exact slice.

The source inverse receipt binds one launch-wrapper removal, one admission
verifier-call reversal, five moved normalization declarations, seven moved
normalization calls, two unmoved startup calls, nine removed fifth
`failShape` arguments, eleven helper-name reversals, one exact-v2 digest
reversal, and two requirements-digest reversals. The fixture inverse binds
exactly one exact-v2 SHA replacement and one helper import-name replacement,
with closure-private brands and no shared non-primitive references.

AST identity
`36af5ac510fda80a291ba09c32f35495d2268898cf97994963ea15049be06b53`
proves nine direct five-argument helper calls: Startup 2, Admission 2, Cancel 1,
RecoveryRequest 1, Diagnostic 2, and Status 1. Seven non-startup normalizations
precede private brand/store lookup; two startup normalizations precede decode.
The private unexported launch wrapper contains only the predecessor return in
its `try`, only `failBinding()` in its binding-free `catch`, no `finally`, and
the sole Admission call; only that wrapper calls the raw verifier. The separate
live runtime-oracle identity is
`57a65ccb545a7c0deaba0f0306273925165e622d0dbc37d1eafc9f4ffa5657f5`
and the three-entry evaluator registration inventory is
`27bf3186c47c62085e1d00ebf638906a7a6a4c17aae363d67127a6c76e0b733d`.

Those three entries retain two TODOs: C16 private-store and C17 final aggregate.
C18-C20 independent review and C21 documentation/umbrella closure remain
pending. The existing 18 exact-v2 exports and nine incumbent importer source
identities remain unchanged; the helper is the additive 19th export. No
package, lockfile, dependency, runtime registry, readiness, or authority changed.
ADR-0036 remains Proposed and readiness remains exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`. This checkpoint
grants no runtime, G1.7, G2.2, qualification, promotion, publication, or push
authority, and it does not resolve the programme's dual-host plan.

This checkpoint is not a registered task profile or production containment
owner. A descendant can escape a POSIX process group, numeric process-group
reuse is not identity-bearing, and pre/post verification detects but cannot
prevent transient executable mutation. The eight payload files are now
retained-FD-bound, but this is explicitly partial: `systemd-run`, `prlimit`,
Bubblewrap, Node, Python, Cargo/Rust, loaders, libraries, and dynamic loading
remain path/runtime TCB. The candidate-specific cgroup owner, pure supervisor
protocol, compile-only supervisor attestation, and successor launch/control
capsule, together with the pure guardian-journal contract, still do not prove
the physical production boundary: the current owner trace is branded
`simulated`, and the local preflight execution does not implement the stable
guardian, delegated cgroup lifecycle, semantic retained-file validation, or
pidfd/waitid reap. None can satisfy the production report
brand. Production remains fixed `unavailable` until the guardian and
interactive native supervisor/adapter exist. Those mechanics and the full
runtime-closure proof,
application receipt v7/replay,
evaluator reconstruction, profile/CLI dispatch, and G2.2 remain mandatory later
gates. Production stays fixed unavailable, schema v1 remains the only
executable registry surface, and no candidate-created product module is
admitted yet.

Current activation boundary:

- `doctor` verifies the local installation and dependency bindings;
- `g1.2 preflight|run|replay` preserves the accepted RocksDB writer-serialization
  contract and its historical receipts;
- `g1.3 preflight|run|replay` binds the additive transaction-capability task to
  its post-G1.2 evaluator, including the expected single `E0432` compiler-red
  baseline and independently green controls;
- `g1.4 preflight|run|replay` binds the five-file writer-admission slice to its
  frozen 1/4/16-writer, reader-liveness, rollback/drop, timeout, and
  cancellation evaluator while protecting every other repository path;
- `g1.4a preflight|run|replay` binds the five-file keyed terminal-outcome slice
  to its evaluator-only public API, memory oracle, RocksDB reopen,
  duplicate-key, rollback/drop, legacy-compatibility, and process-abort
  lost-acknowledgement cases. The same evaluator commit updates the two older
  RocksDB capability assertions, so candidate verification runs the complete
  capability and compatibility targets without exclusions. Within the fixed
  seven-stage receipt vocabulary, the supplemental `service` slot carries the
  capability target and `compatibility` carries the compatibility target;
- `g1.4b preflight|run|replay` binds the sole mutable RocksDB wrapper to a
  frozen, evaluator-separated fault matrix for storage-call errors before and
  after staging, commit-attempt, final-batch, and rollback writes. Its runtime
  red signature is exactly six passing and two failing library tests: both
  failures expose a false RolledBack proof after commit-attempt marker errors.
  The qualified change must advance the in-memory phase before that marker
  call, keep durable Staging and CommitAttempted lookup indeterminate, and
  preserve one attempt plus one atomic final batch. This evidence covers the
  simulated state-machine branches only; it does not claim crash, power-loss,
  or fsync durability. Run `g14b-phase-order-20260828` selected patch
  `02f10b26613ce403120bb68867ea739295225a9c630970e25911694eb94a1314`;
  receipt `d4a54f90ab4edbbb86ee7b76a984ad97032e5e8abb3d884583c90ec3ed6c03ad`
  and exact replay both returned `ACCEPT`, and product commit `590a3229`
  passes the exact 8/8, 7/7, and 20/20 counted controls;
- `g1.5 preflight|run|replay` activates `http-client,rdf-12` explicitly and
  binds the six-file unified egress slice to deny-by-default SERVICE, LOAD,
  nested-document, response-limit, connection-budget, cancellation, and
  rollback evidence;
- `g1.5b preflight|run|replay` binds the four-file local UPDATE cancellation
  closure to typed cancellation before validation, during serialized RocksDB
  writer admission, and throughout mutation, while independently preserving
  writer-admission and G1.5 egress-policy evidence;
- `g1.5c preflight|run|replay` binds the three-file additive negotiated-update
  admission slice to the caller's exact request and cancellation token for
  custom backends and `Store`, while preserving the minimal transaction traits;
  its independent command runs both capability and writer-admission targets and
  its regression command runs cancellation, egress, and transactional-dataset
  targets. Command exit status proves every target in each set; the scalar
  receipt counts bind the final Cargo result lines (9 independent, 3 regression).
  Clean RocksDB builds use one Cargo job and a 12 GiB `/state` tmpfs ceiling so
  the feature-active build and later default-feature reference artefacts coexist.
  `maxResidentBytes` is the 16 GiB aggregate cgroup ceiling and includes that
  tmpfs state together with compiler, linker, and verifier process memory;
- `g1.6 preflight|run|replay` binds the four-file runtime-service-capability
  slice to a frozen two-path evaluator. The public evaluator identity remains
  the added `sparql_effective_capabilities` target, while private repository
  validation also freezes the modified CLI service-description tests, their
  Git order, and both blob/content identities. The task derives federation and
  remote-load claims from the shared evaluator's effective handlers, egress
  policy, and compiled transport without DNS or network probes; the server
  profile remains deny-all while standalone CLI query/update stay permissive.
  Its seven ordered stages are format, build, public, service, compatibility,
  independent, and regression. Verification runs the four-test
  `sparql_effective_capabilities` integration target as `public`, then runs
  only the 17 feature-active filtered
  `service_description::tests::` binary-unit tests as a separate bounded
  `service` stage. The separate `compatibility` stage requires exactly one
  ignored
  `service_description::tests::dependency_qualified_library_tls_is_enforced_without_cli_tls`
  canary under dependency-qualified library TLS with every CLI TLS feature
  disabled. The final frozen references require exactly one `independent` and
  12 `regression` results; unrelated CLI binary tests are outside these argv
  surfaces.
  The verifier disables Cargo incremental state and test-profile debug info to
  keep cold state deterministic and bounded. Command timeout or exhausted
  verifier state (`ENOSPC`/`EDQUOT`) is infrastructure-inconclusive, cannot
  trigger a repair lane, and cannot mint routing quality. G1.6 requires exact
  counted-stage results 4/17/1/1/12. Five- and six-stage historical contracts
  and their existing application receipts remain replayable;
- `g1.7:preflight`, `g1.7:run`, and `g1.7:verify` use a separate qualification
  binary rather than the application-task registry. Exact qualification
  contract v7 has SHA-256
  `42ed386779934ff86cd3369eb56764d0d41bf1a0a2b989166fec33e73d268d80`.
  Its exact proposed control authorization and final decision set have raw
  SHA-256 values `31b8fce50d503f50656c5390cfe8d35913babeec54fc67906b20e66e7d713767`
  and `b0def4f0a3efa845aed557305045a79c6c9c22a455f09719dfca0bf903d595e5`.
  They remain `CONTROL_AUTH_PROPOSED` and `PROPOSED`/`UNAPPROVED`, so `run`
  exits 4 before identity, copied evidence, build, runtime-directory creation,
  or samples and writes no G1.7 run. A final binding remains non-authoritative
  until canonical control-receipt replay exists. Contract v1/v3/v4/v5/v6 bytes
  use Darwin-free pure `LEGACY_REPLAY_ONLY` dispatch; v5 and v6 proposed
  protocol artifacts are separately frozen by exact byte identity. Synthetic
  owner fixtures test replay but are not production owner evidence. The
  accepted G1.4b receipt is
  exact-bound at the prerequisite boundary, with projection `d57eb7cb...` and
  binding `5a4f5721...`, but it cannot replace the control receipt or execution
  owners. No controls, samples, benchmark result, current-v7 receipt,
  qualification, or promotion exists. The implemented lifecycle is a two-phase
  human gate: authorize permanently non-promoting negative and A/A controls,
  seal/replay them, then approve one final decision set binding that control
  receipt and the G1.4b prerequisite before subject/reference qualification.
  Promotion remains a later human-only action. V7 preserves v6's exact frozen
  authorization-bound sample-set framing/order, paired 10% negative-control
  non-inferiority, shared-seed two-direction 5% A/A equivalence, the inclusive
  5% MAD noise boundary, and mechanical FAIL/INCONCLUSIVE/PASS precedence. Its
  pure replay is differential-tested against the exact installed Darwin 0.9.3
  source modules. Commit `f04b9bc7` adds a dormant, authority-free containment
  owner that rejects the current proposed authorization before mechanics;
  there is no native syscall adapter. Commit `a457f46c` adds the exact four-
  build execution plan and descriptor-anchored product-source workspace with
  global pre-write Git-object admission and unreaped-handle retention.
  Production build begin/finish deliberately return `MISSING` until a physical
  supervising owner can issue non-forgeable child-close/reap proof. Commit
  `c5687dac` adds capability-free build-process and four-product replay over the
  frozen Cargo request/environment, held source/tool/output ancestry, raw
  streams, executable bytes, and ELF identity. It returns `binding: null`,
  `finalDecisionEligible: false`, and all authority false. These are contract,
  source, containment, and capture-replay mechanics, not a live control run,
  physical build owner, or receipt. Commit `3688ccda` adds a stricter v2
  build-owner projection but keeps it explicitly replay-only. Commits
  `008ab939`/`da41d7e0` freeze the non-tmpfs policy and exact FD-relative
  `/workspace/source` read-only plus `/state/target` writable mapping policy;
  they do not execute a mount adapter.
  Commits `5d054857`/`a9f9afc2`/`f482bec0`/`3b289522` retain unsafe
  containment state and bound the complete destructive cleanup, lease-release,
  and close sequence. Commit `c5050e9c` adds a POSIX raw-byte process supervisor with
  a shared output cap, bounded argv, typed first-terminal reason, process-group
  TERM/KILL escalation, distinct close/EOF/reap truth, and unreaped-handle
  retention. It is authority-free infrastructure; the private physical issuer
  and native containment adapter remain absent. Commit `13afa94d` freezes
  canonical execution-request v1 bytes over exact authorization, plan, policy,
  source, toolchain, owner, process-generation, and full Cargo argv identity;
  `3f8951e3` rejects accessor-, proxy-, and prototype-substituted byte inputs.
  Request v1 permanently binds isolation policy v1 and is therefore explicitly
  launch-ineligible. Commit `8b2c6366` adds replay-only process-evidence v3,
  exact-linked to the request and containment owner input and retaining raw
  Cargo JSONL, raw cgroup terminal observations, and a held executable target
  ELF. It remains `SUCCESSOR_PRIVATE_ISSUER_REQUIRED`, with `binding: false` and
  authority-free. A successor isolation/request contract, attested native
  `execveat` helper and bounded READY/error/EOF protocol, private issuer, and
  containment v2 remain absent;
- upstream merge `e9d2db1b` is exact-tree audited and is now the v7 product
  subject. Commit `d1e18c6e` binds its exact tree and `Cargo.lock`, records the
  evaluator as already present, separates the later control commit through
  qualified identity v2, and archives v6 byte-for-byte. Reseal task
  `task-1787888366495-gzxbhe` is complete, but grants no execution authority;
- `receipt verify` independently verifies stored application receipts without
  granting promotion authority;
- application receipt v6 adds an exact `candidateRejections` collection and
  event kind. Each record binds one candidate execution, one successful
  implementation or repair invocation, its patch SHA-256, a typed
  reconstruction/applicability phase and failure code, and a digest of bounded
  canonical failure detail. One invocation may be represented by an attempt or
  one rejection, never both; paired lanes are not deduplicated by patch digest.
  These pre-verifier failures authorize no Router quality. Candidate-disposal
  failure is outside this evidence type and aborts receipt minting;
- v5 retains bounded rejected critique and review diagnostics together with the
  optional exact-count `compatibility` verifier stage; v4 preserves both
  diagnostics as mandatory, and v3 keeps rejected critique diagnostics
  mandatory with rejected review diagnostics optional for historical replay.
  Versions v1-v5 are byte-exact replay-only and cannot mint current routing
  quality;
- `factory diagnose` evaluates disposable `metaharness new` output without
  adopting its publication settings, broad permissions, legacy dependencies,
  or nonexistent MCP commands;
- no generated host configuration is installed; and
- no MCP server is registered until one canonical command registry is exercised
  through both the CLI and real JSON-RPC tests.

The committed control surface is now generated from one fail-closed registry.
`engineeringTaskRegistry` is the sole ordered identity authority for these
exact task IDs:

```text
g1.2-rocksdb-serialized-writers
g1.3-transaction-capabilities
g1.4-bounded-writer-admission
g1.4a-store-terminal-outcomes
g1.4b-outcome-fault-safety
g1.5-unified-egress-policy
g1.5b-update-cancellation
g1.5c-negotiated-update
g1.6-runtime-derived-service-claims
```

Each contract path is derived as `tasks/g1/<slug>/contract.json`; public contract, preflight,
programme, and replay APIs select by canonical `taskId` only. Unknown,
path-like, inherited, accessor-backed, duplicate, or caller-path-selected task
identities are rejected before filesystem, runtime, verifier, or receipt I/O.
The exported per-G1 profiles, contract-path constants, and named wrappers are
compatibility shims over that generic task API, not parallel dispatch
authorities.

The same registry generates the task portion of an exact ordered 33-command
CLI surface. The CLI resolves a slug to its registered `taskId` and dispatches
preflight, run, and replay dynamically; the registry admits no extra, missing,
duplicate, reordered, or malformed command. Its canonical order is:

```text
doctor           -> doctor
g1.2.preflight   -> g1.2 preflight
g1.3.preflight   -> g1.3 preflight
g1.4.preflight   -> g1.4 preflight
g1.4a.preflight  -> g1.4a preflight
g1.4b.preflight  -> g1.4b preflight
g1.5.preflight   -> g1.5 preflight
g1.5b.preflight  -> g1.5b preflight
g1.5c.preflight  -> g1.5c preflight
g1.6.preflight   -> g1.6 preflight
g1.2.run         -> g1.2 run [--run-id <safe-id>]
g1.2.replay      -> g1.2 replay --receipt <runtime-name>
g1.3.run         -> g1.3 run [--run-id <safe-id>]
g1.3.replay      -> g1.3 replay --receipt <runtime-name>
g1.4.run         -> g1.4 run [--run-id <safe-id>]
g1.4.replay      -> g1.4 replay --receipt <runtime-name>
g1.4a.run        -> g1.4a run [--run-id <safe-id>]
g1.4a.replay     -> g1.4a replay --receipt <runtime-name>
g1.4b.run        -> g1.4b run [--run-id <safe-id>]
g1.4b.replay     -> g1.4b replay --receipt <runtime-name>
g1.5.run         -> g1.5 run [--run-id <safe-id>]
g1.5.replay      -> g1.5 replay --receipt <runtime-name>
g1.5b.run        -> g1.5b run [--run-id <safe-id>]
g1.5b.replay     -> g1.5b replay --receipt <runtime-name>
g1.5c.run        -> g1.5c run [--run-id <safe-id>]
g1.5c.replay     -> g1.5c replay --receipt <runtime-name>
g1.6.run         -> g1.6 run [--run-id <safe-id>]
g1.6.replay      -> g1.6 replay --receipt <runtime-name>
receipt.verify   -> receipt verify --receipt <runtime-name>
history.inspect  -> history inspect
factory.diagnose -> factory diagnose --claude <outside-path> --codex <outside-path>
help             -> help
version          -> version
```

The right-hand forms are the usage strings printed by `help`. Commit
`4a15caa07df37d884e7c74d4b69c0505ce3de6e1` implements this control. Its
committed tree passes all 180 engineering-harness tests and reports
`runner-implemented` from `doctor`, with all five dependencies requested from
`latest`, both native host interfaces valid, `mcpRegistered: false`,
`localOnly: true`, and `promotionAuthority: false`.

Commit `afe30c7de7e3df6e72a0a855d83efc612339f261` implements the follow-on
rejection-evidence control. Its committed tree passes all 194 harness tests and
the same doctor boundary. Adversarial coverage includes two independently
failed provider lanes, a mixed accepted/rejected run, frozen-submodule and
thrown-verifier failures, repair reconstruction, exact event ordering,
identical-patch lane separation, raw-detail non-retention, disposal abort, and
fixed SHA-256/byte-length replay fixtures captured from pre-v6 v1-v5 receipts.
The detail digest is hash-bound evidence, not a signature or a way to recover
the deliberately discarded raw error.

G1.3 product commit `3bf9468c` has also passed the harness's direct candidate
reconstruction and frozen verifier: exact patch `2d5412df6210246266426e3b7ee8be599744fc1093c9ac272b8d8d64a34fef04`,
candidate tree `b369e766a3f8c02f6d580924dd943e08ebafcdf0`, unchanged protected
manifest, and green format/build/public-9/independent-3/regression-3 stages.
The earlier application runs remain useful routing and failure evidence; they
do not replace this source-bound product verification or grant promotion
authority.

G1.4 product commits `b2ed9119` and `5a704914` also passed direct candidate
reconstruction and the frozen verifier. Contract
`cc20ae29420ff2a3b328b35bdc8f26dcd6cd39e978ec6fcfc0de93290334df39`
admitted exact patch
`47bfdb31333a13ba5d90bca3f06767fe889f05c0e9aebf5b3628d3942eafa7db`
as candidate tree `7d47e7352d64171563da8dd8d00fcb9b4c1f790d`, retained protected
manifest `537184400702bd927208c3f314c014386a65390061f263d7924855d38777bb3b`,
and returned `ACCEPT` for format/build/public-6/independent-2/regression-2 in
313.959 seconds. The verifier session artifact has SHA-256
`1a6061c95e1cf960aeb8d7f0145b032c60a0423e0f69afbc5a92731a3594729a`.

G1.5c product commit `3afe1e78` passed its direct frozen verification after an
exact `CONFIRMED_RED` preflight. Contract
`05b6ba498344fc412a810bb79eb80344f90577a442ce03c41637cbabd4a26ce1`
admitted the 7,252-byte three-path patch
`229d326bb22f46b992bc6d6212be1346de88b0d5bf1b9cad56dc0150611066c8`
as candidate tree `40137fa6306e8c282da16fbeb0d46418e27d0f3a`, retained the
1,389-entry protected manifest
`f0d009cd1b48b6c850b45026a2956fea752c8e9cf932022d7e34aa37cf5fb2bb`,
and returned `ACCEPT` for format/build/public-5/independent-15/regression-21 in
1,337.018 seconds. The 118,202-byte verifier session has SHA-256
`94461758757f1d4402713f6bed115e1bbd318d1fc35b02c7ea2c3b27a2b3f23b`.

G1.6 exact product commit `96d0ae7b177026506f4c8bfc74cf2eb88e71abc4`
is integrated unchanged by merge commit
`baeabb067c8c8419973842e5e060adf832e3f738`. Evaluator
`8dcb795a08e3605c18c662d13b040311a260ac2b`, evaluator tree
`973d5ed5615fc2f34a1e9d0da657d01f5c899755`, evaluator patch SHA-256
`93893693ed9804d56589169168c4dcd464bdeef2bc8dfea9e0eee0689888cee6`,
contract SHA-256
`abd16ee2f4d2c7c4b89b651e9412e126cac468456e7a1633c1143dce1f5accd3`,
and protected 1,398-entry manifest SHA-256
`a5c3f5c448a9aa1a615f7b4b1d60b8c5e43965240c5981acb66fa356831b155f`
bound the accepted run. The exact product patch SHA-256
`6ac04ebee08ce571e403a3937c41d258521bf9e172b2f3e666949266b73239b3`
reconstructed candidate tree `269ccb9b519c6beaf311bfc9ec5c7539acb79498`.
After a `CONFIRMED_RED` preflight, the verifier returned `ACCEPT` for
format/build/public-4/service-17/compatibility-1/independent-1/regression-12
in 1,153.499 seconds. Its 126,368-byte artifact has SHA-256
`4ff0fdafa3b8584f81033a89000814320a952bbc384523cd72dd57150963458b`.

The exact negative-control matrix also closed:

- Earlier-product patch
  `1b30556c3392aaf1a4f0041ce3f69fd00a929fba4fd62ee2b4c04edb6297566e`,
  tree `7b3cf9567cd6ca763165f38727675dec66870c00`, candidate
  `9aad0121280e32ddbbc0893c4cc583d10f065eb7`, was rejected after public-4,
  service-15 with two failures, compatibility-0 with one failure,
  independent-1, and regression-12. Its 1,139.452-second verifier artifact is
  `96dc288bc70f5d5dfb62ce02d5954330534ac7921da17e912d74af4b6a200740`;
  atomic outer evidence is
  `9e5c54a5e687948b4183bb57878764975cc0a7701a86e02ce3ab8254eb89287c`.
- Union-only patch
  `543379f0df24e5f8e144239d7dc674e1e618521494fa9f0c7b2132b12e88e330`,
  tree `f249d49ebf440734e0e05368ea78ac6c0f444e52`, was rejected after
  public-4, service-16 with one failure, compatibility-1, independent-1, and
  regression-12. Its 1,148.684-second verifier artifact is
  `393b8c7239986a654e80f5213b653ea5c494fec4878b7fd79ced9a9c39321046`.
- CLI-TLS-gated server patch
  `e3f15a88f61711873a1e7f9f41a79fae737b8531d9f9422309ec7d488e4e9578`,
  tree `964a63bf5f91a44f569565e1fa1de7bb262ce7cd`, was rejected after public-4,
  service-17, compatibility-0 with one failure, independent-1, and
  regression-12. Its 1,147.933-second verifier artifact is
  `3635ef690d75d10d8d5b4d7b316b7c6d487d7f6e9a8b47055a0c86630e387f5d`;
  atomic outer evidence is
  `33049ddad8d1136015f7b5a866ba4ba9b8e0d2953606de9195d7ef7f17c38333`.

A direct verifier test rejects compatibility counts of zero or two. These are
verifier-session artifacts, not application receipts. The contract remains
`localOnly: true` and `promotionAuthority: false`; acceptance neither qualifies
semantics nor authorizes product promotion or publication.

Install and verify from this directory:

```bash
npm ci --ignore-scripts
npm test
npm run doctor
npm run g1.3:preflight
npm run g1.4:preflight
npm run g1.5:preflight
npm run g1.5b:preflight
npm run g1.5c:preflight
npm run g1.6:preflight
npm run g1.7:preflight
```

At the current fail-closed checkpoint, `npm test` reports 1,118 tests: 1,106
pass, two fail, three intentional live-host tests are skipped, and seven are
TODO. One failure is ADR-0036's deliberate absent-candidate stop. The other is
the G1.7 identity gate refusing product paths changed after its sealed `e9`
subject; that subject must be reviewed and resealed through its own authority
boundary, never silently refreshed. This is not a green qualification result.
`npm run doctor` passes with 33 registered application commands, both native
host interfaces valid, `mcpRegistered: false`, and the latest-policy lock
resolving AVO 0.1.4, Darwin 0.9.3, Harness 0.2.0, Router 0.4.0, and MetaHarness
0.4.8. Those versions are lock evidence, not a promise that future `latest`
tags will remain unchanged.

The `npm test` totals above are the preserved pre-C15 broad checkpoint; they are
not relabelled by the focused C15 GREEN result. The dated C15 matrix is the
explicit three-runtime direct/main/helper/ADR-verifier matrix recorded above.

### ADR-0036 C16 checkpoint — 2026-09-02

The C15 section above remains historical evidence. C16 is GREEN from RED commit
`5f717090fcc118d299cadf446fe0703026d360b6` to integrated commit
`930a7722490b8ad63d6825a25bd7bcb138140dd3`, tree
`2492ce6e2dd4f73e1c9749e657f05e09e71fd962`; the integrated patch SHA-256 is
`c81948744ff415d4ab72cea4a7aa51ceedfcf2da25def018e91232dfbd85bb87`.
Only the evaluators changed. The adversarial evaluator is 658,087 bytes at
SHA-256 `b2edf959bf2e7bd933d37c3521c495da955b1e7a4eac069361465f443de423ef`
and Git blob `63fa67d7bd4fe7a2921fbc8f77c57b8e75adb010`; the main evaluator is
912,778 bytes at SHA-256
`bc0b322dc5394a30fd846bd756899d77e6dfdec783108c648720ad2ba4ca2207`
and Git blob `aa8253e7188a7499d840ea7eac7ed71fa3184677`.

The frozen private-store receipt identity is
`914baa75ad37e662895caf2002f98f395c47586bd8681d746ecd97820c7a18aa`.
It binds three stores, ten owner operations, five phases, and 50 unique controls
(40 primary and ten fresh), with ten controls per phase. Store owner/control
splits are 1/7/2 and 5/35/10. Candidate behavior is 274 attempts / 224 successes
/ 50 rejections; owner targets are 70/30/40; primary/fresh calls are 246/28;
setup/downstream calls are 168/36. The exact control-ID and owner-operation
preimages have identities
`fcecf21e42d79a9a8f40d0514c1c2f2cdbf77b9af2dd64630347053f81eea364`
and `828671fb22e3cb674daa99d972b87250cf059da5e0524d8b725407f66f0748b1`.
The exact ordered phase-name array has identity
`c7c768bdabe36cc08a7bcafdfc4046c3647a4fa13b77fcdc6a1d1891bdd178f9`;
the distinct exact sorted phase-count object preimage has identity
`61af05cd58789f22f82dc3014e2ba36fd3781183437d0ba0326edfef78f193ae`.

The fresh candidate is distinct and loaded once through read/pin/decode/audit/
import sequence 1/2/3/4/5, with a one-step ordinal advance, canonical source
SHA-256 plus padded ordinal query, and the full main audit before import. The
live oracle remains
`57a65ccb545a7c0deaba0f0306273925165e622d0dbc37d1eafc9f4ffa5657f5`.
The registration inventory now has three entries, zero registration TODOs, and
identity
`b91336686a76ed8b28d2b68dbc4f6739d60486a1ea03d30797d6980bcb5c04c9`.

Current Node 24.14.1, exact Node 20.0.0, and Node 20.20.2 each pass direct
11/11/0/0 and report main 19/18/0/1 and combined 30/29/0/1
test/pass/fail/TODO. The post-integration Node 24.14.1 combined result is the
same; the helper passes 20/20 and the ADR verifier passes 1/1. Independent
review returned APPROVE with no findings and reproduced combined results on
Node 24.14.1 and Node 20.20.2. These focused C16 totals do not relabel the
preserved broad `npm test` totals above.

C17 final aggregate is the sole evaluator TODO; C18-C21 remain pending. At the
pre-documentation freeze, task `task-1788204847572-uh0olo` was recorded
`in_progress` at 95%; its ledger closure is a post-integration action, not
evidence conferred by this README. ADR-0036 remains Proposed and readiness
remains exactly `{status: "unavailable", reason: "native-adapter-unavailable"}`.
No source,
helper, fixture, package, lockfile, dependency, runtime, filesystem, process,
cgroup, G1.7, G2.2, qualification, promotion, publication, push, product, or
physical authority changed, and the dual-host plan remains unresolved.

The package is local-only. Presence of this directory is not an engineering
readiness, product-correctness, semantic-qualification, or promotion claim.
