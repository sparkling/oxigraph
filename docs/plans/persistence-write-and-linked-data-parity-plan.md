# Persistence writes and linked-data-store parity plan

- Status: R1 delivered at source handoff `aa7128bb`; G2.2 capture/integration is
  implemented; G2.3a durable receipts is the next active product
  slice. Backend-neutral writes and the upstream delta are verified. G1.7,
  ADR-0034 through ADR-0041, and P1-P3 breadth are future roadmap work and do
  not gate R1
- Date: 2026-08-24
- Updated: 2026-09-07
- Repository: `sparkling/oxigraph`, maintained as a fork of `oxigraph/oxigraph`
- Previous upstream baseline: `oxigraph/oxigraph` `8dcfb6b66cbb077bb2406379abb280d2471970d7`
- Current audited upstream head: `7ce152a1d910d5662027a5bcbe7c32cee0a4e059`
- Current maintenance-equivalent local integrations:
  upstream `41768ccf` as `d5343f6b`; upstream `786d0017` as `c86772a9`;
  upstream `7ce152a1` as `eb0f0cc2`
- Current product-semantic upstream integration: `eb0f0cc2`
- Historical first upstream merge: `a2415a4e`
- Transactional write implementation: `1da47285`
- Deterministic upstream test correction: `f9033c2b`
- Conservative service-description reconciliation: `7dc190d3`
- Runtime-derived service claims: `baeabb067c8c8419973842e5e060adf832e3f738`
- Engineering harness registry:
  `4a15caa07df37d884e7c74d4b69c0505ce3de6e1`
- G1.7 v6 pure protocol/statistics checkpoint:
  `799307fb8b7ac7f359068c59e552ab7147363981`
- G1.7 pure owner/receipt-candidate checkpoint:
  `45121da9e9441978b6233dfcc3431a760005bb72`
- G1.7 physical control-envelope checkpoint:
  `fbbb692bbdf92a2dc7c748de2a15995debdadc1b`
- G1.7 dormant containment checkpoint:
  `f04b9bc7`
- G1.7 source-workspace checkpoint:
  `a457f46c`
- G1.7 legacy request/process-evidence checkpoint:
  `8b2c6366`
- G1.7 successor policy/request-v2 structural checkpoint:
  `ef869cf4` / `466d2d78` / `75a076938ac6c4ecc72c295f56d09e5c0f8e8787`
- G1.7 dormant helper-attestation checkpoint:
  `c113a88f321ade44e7d913f5da87a8184ea56148`
- G2.1 transactional namespace checkpoint:
  `be08cf3bbcb836ec46df2b864d31e80f5b837b52`
- ADR-0034 early-gate and frozen exact-create chain:
  `fd9e4d05` / `c9cb6423` / `997ad287` / `dfd6d92d`
- ADR-0034 separate dormant-v2 registration checkpoint:
  `f9ab7c7223ed490ad83b6544246d66323cd1e86a`
- ADR-0034 dormant command-literal checkpoint:
  `99f94fac727fd63d79810a2e36e2e0b48436eddc`
- ADR-0034 application-receipt-v7 checkpoint:
  `f6897d340fe5cd4a3db2d7bdb52fed2d37cd261d`
- ADR-0034 hidden dormant CLI/package checkpoint:
  `b915c5f60d865d0be92afde070d30419a7179c00`
- ADR-0035 local executable-preflight checkpoint:
  `040f33438693d3e3f64f8052a849b1c84caa58d8`
- ADR-0036 C15 guardian-control checkpoint:
  `4620dd92273c06e997a55a2204a01d311f3027de`
- ADR-0036 C16 guardian-control checkpoint:
  `930a7722490b8ad63d6825a25bd7bcb138140dd3`
- Architecture decision: [ADR-0016 — Backend-neutral transactional RDF writes](../adr/0016-backend-neutral-transactional-writes.md)
- Exact new-file admission decision:
  [ADR-0034 — First-class exact new-file admission](../adr/0034-first-class-exact-new-file-admission.md)
- Durable containment guardian decision:
  [ADR-0035 — Durable native containment guardian and crash recovery](../adr/0035-durable-native-containment-guardian-and-recovery.md)
- Guardian-control pure-ABI decision:
  [ADR-0036 — Guardian-control pure ABI](../adr/0036-guardian-control-pure-abi.md)
- Durable statefs/syscalls decision:
  [ADR-0037 — Durable containment statefs and manager protocol](../adr/0037-durable-containment-statefs-and-manager-protocol.md)
- Native process-mechanics decision:
  [ADR-0038 — Native containment manager, guardian, and launch trampoline](../adr/0038-native-containment-manager-guardian-and-trampoline.md)
- Host qualification and activation decision:
  [ADR-0039 — Delegated-host containment qualification and readiness](../adr/0039-delegated-host-containment-qualification-and-readiness.md)
- Commit-capable containment decision:
  [ADR-0040 — Commit-capable containment decision and application-output release](../adr/0040-commit-capable-containment-decision-and-output-release.md)
- Private G1.7 physical-owner decision:
  [ADR-0041 — G1.7 private co-located build issuer and physical owner chain](../adr/0041-g17-private-co-located-build-issuer.md)
- Persistence-backend decision:
  [ADR-0042 — Retain RocksDB and gate replacement-backend experiments](../adr/0042-retain-rocksdb-and-gate-replacement-backend-experiments.md)
- Delivery-recovery decision:
  [ADR-0043 — Delivery recovery and proportional release boundary](../adr/0043-delivery-recovery-and-proportional-release-boundary.md)
- Outstanding capability decisions:
  [ADR-0018 and ADR-0020 through ADR-0042](../adr/README.md)
- Execution harness:
  [linked-data-store evolution plan](linked-data-store-evolution-harness-plan.md)

## R1 delivery recovery boundary

R1 ships the existing ADR-0016 write seam, the audited upstream `7ce152a1`
product delta, proportional product/conformance/binding/fuzz validation, and
truthful release documentation. The upstream integration is committed as
`eb0f0cc2`; it preserves named-graph-only union-default semantics,
source-graph-aware blank-node standardization for explicit RDF merges, and
SPARQL-version validation across RocksDB and generic dataset paths.

The N3 fetchability blocker is resolved in `75f538e0`, with the unchanged
reviewed gitlink available from its declared fork remote
([publication verification](../research/n3-submodule-publication-2026-09-07.md)).
The optimized release binary passed 15 persistent HTTP journey checks and
14 focused Rust transaction/topology tests
([application validation](../research/r1-application-validation-2026-09-07.md)).
Documentation/ledger reconciliation and authorized publication are complete
at source handoff `aa7128bb`, with the programme Gist updated and read back.
G2.2 normalized semantic change sets is implemented in task
`task-1788781295095-lrzbqi`; G2.3a atomic receipts is next in
`task-1787670631130-9jlo3h`. G2.2 supersedes the historical containment-gated
`task-1788069137230-uuulsx` without deleting that task's history. The six-hour
review continues across milestones until the programme is complete or stopped
by the owner. G1.7, ADR-0034 through ADR-0041, Dream Machine,
GEPA/AVO, broad Jena/RDF4J parity, and P1-P3 features remain recorded below as
future work. They are not R1 gates. Direct product behavior and the applicable
native/conformance tests are progress authority under ADR-0043.

The detailed evidence below is retained as programme history. Where historical
sequencing or task prose conflicts with this section, ADR-0043 and this dated
boundary are current.

## Outcome

G2.2 provides `ChangeTrackingTransaction` and pending `SemanticChangeSet`
snapshots over the existing write traits, plus `execute_with_changes()` for
whole generic, negotiated, and keyed SPARQL Update requests. Point effects
normalize within affected graph/namespace boundaries; lifecycle summaries and
failure poisoning are explicit. Owned requests return changes only after
acknowledged commit and preserve typed indeterminate keys without replay.
G2.2 is implemented; durable receipts, outbox, and global ordering remain
G2.3a-c, so ADR-0020 remains Proposed.
See [ADR-0020's current slice](../adr/0020-transactional-metadata-receipts-and-change-delivery.md#g22-staged-effect-capture-slice-2026-09-07).

The clone is patch-current with audited `upstream/main` `7ce152a1`. Local
commit `eb0f0cc2` integrates its merged-default-graph product change plus two
fork-specific RocksDB regressions. Earlier maintenance-equivalent commits
`d5343f6b` and `c86772a9` remain part of the traceable upstream history.

Native Codex Astra support includes `low`, `medium`, `high`, `xhigh`, `max`,
and `ultra`; `7d89e7bc` corrects the stale adapter and enables native parallel
delegation for Ultra without changing legacy task contracts. ADR-0043 sets
the current role policy: Astra High/Xhigh for consequential judgment, Sol High
or Opus for difficult implementation, Terra Medium or Sonnet for routine
slices, Max for a hard single problem, Ultra for useful independent subtasks,
and Luna/Haiku for narrow language work. User-selected efforts take precedence
over the older helper's escalation recommendations. Historical Sol receipts
remain unchanged; their qualification state does not gate native product work.
No router training, provider fallback, new receipt format, or model benchmark
is required to deliver R1 or G2.2.

ADR-0042 now records the evidence-backed persistence-backend disposition:
RocksDB remains the sole production-intended persistent `Store` backend, and
TurboKV is not adopted at audited post-release commit `5706b6ba` (whose
manifest still declares 0.6.0). Any alternative must begin as a separate
non-default semantic falsification experiment and pass
the unchanged transaction, topology, namespace, outcome, failure, concurrency,
reopen, operations, migration, and matched RDF workload gates. No replacement
dependency, adapter, benchmark result, migration, or production claim is added.
Pre-existing adapter-conformance task `task-1788042251643-t1d67p` is cancelled
because no replacement is selected; this decision releases no implementation
task, and any future candidate requires a new explicitly scoped task.

The missing persistence-plane capability was narrower than “Oxigraph cannot
write.” Concrete writes already existed through `Store`, transactions, SPARQL
Update, Graph Store Protocol, bulk loading, and language bindings. What was
missing was a backend-neutral transactional write contract. That contract is
now implemented by `TransactionalDataset` and `WritableDataset`, with generic
SPARQL Update binding through `PreparedSparqlUpdate::on_dataset`.

The remaining work is hardening and linked-data-store breadth. Transaction
capability negotiation, bounded writer admission, G1.5's unified remote egress,
G1.5b's update-owned cancellation, and G1.5c's negotiated backend-admission
profiles are now source-bound. G1.6 is also implemented: its seven-stage
verifier accepted exact public/service/compatibility/independent/regression
counts 4/17/1/1/12 and rejected the earlier-product, union-only, and
CLI-TLS-gated-server controls. Service descriptions now derive deterministic
configured-and-compiled SPARQL capabilities from the same evaluator's
effective handlers, egress policy, and transport. They are not network-health
or current-admission probes. The earlier conservative reconciliation in
`7dc190d3` remains part of the lineage rather than the final claim model.
G1.4a is now implemented in `2f518e04`: its evaluator-separated seven-stage
verifier accepted the built-in Store lifecycle and durable transaction-key
lookup with exact 7/9/20/3/2 counted stages. G1.4b is implemented in
`590a3229`: its accepted and exactly replayed application receipt turns the
frozen 6/2 red phase-order signature into 8/8 green while 7/7 outcome and 20/20
compatibility controls remain green. It proves injected storage-call and
malformed-ledger behavior, not crash, power-loss, or fsync durability. G1.7
contract v7 and its merged-product identity are integrated and fail-closed;
they preserve v6's two-phase protocol: control
authorization and the final decision set remain proposed/unapproved, and `run`
exits 4 before work and writes no G1.7 run. Exact G1.4b prerequisite binding,
Darwin-free v1/v3/v4/v5/v6 legacy replay, canonical sample framing, paired
negative/A/A estimators and seeds, the MAD boundary, and mechanical verdict
precedence are implemented. Commits `d3af2e17` and `45121da9` complete pure
benchmark-owner bundle verification and bounded canonical control-receipt
candidate replay over four builds, two controls, and 392 launches. It remains
`CANDIDATE_REPLAYED`, `finalDecisionEligible: false`, and `binding: null`.
Commit `fbbb692b` separately implements exact three-file physical sealing and
current-state replay with exclusive no-follow creation, 0400 files, a 0500
directory, receipt-last owner sequencing, ordered sync calls, held-FD
filesystem/device checks, and exact post-seal replay. Seal returns no binding;
only replayed PASS can yield a prospective binding, and all authority remains
false. This proves the observed owner sequence and current archive state, not a
live control owner, replay reconstruction of historical receipt-last order,
crash/power-loss/filesystem-flush durability, same-UID tamper resistance, or
approval. Commit `f04b9bc7` adds the dormant containment contract/owner without
invoking a native containment capability. Commit `a457f46c` adds the exact
execution plan and source-workspace materializer, including bounded Git object
admission and fail-closed process/handle semantics. Commit `c5687dac` adds pure
Cargo process and build-product evidence replay. It proves the supplied capture
claims and held-object relationships, not independently observed Cargo
execution or artifact provenance; binding stays null and all authority remains
false. Replay-only build-owner v2 (`3688ccda`) is stricter but still cannot
mint physical provenance. Commits `008ab939`/`da41d7e0` freeze the non-tmpfs
policy and exact source/target mount-namespace mappings without executing a
native adapter; bounded containment retention and
cleanup culminate in `3b289522`. Commit `c5050e9c` adds an authority-free
POSIX raw-byte process supervisor with shared output/argv limits, typed first-terminal
reason, process-group escalation, separate close/EOF/reap truth, and retained
unreaped handles. Commits `13afa94d`/`3f8951e3` freeze and harden canonical
execution-request v1, which is permanently launch-ineligible because it binds
isolation policy v1. Commit `8b2c6366` adds exact-linked replay-only
process-evidence v3 with raw Cargo JSONL, cgroup terminal observations, and a
held target ELF; its disposition remains `SUCCESSOR_PRIVATE_ISSUER_REQUIRED`
and all authority is false. Request v1 and process v3 are legacy-incompatible
with the successor path. Policy v2 (`ef869cf4`, corrected in `466d2d78`) and
execution request v2 (`75a07693`) now bind the successor structural contract.
Request v2 remains `POLICY_V2_BOUND_PRIVATE_ISSUER_REQUIRED` and
`STRUCTURAL_POLICY_ONLY`, with no physical-launch eligibility, binding, final
decision eligibility, or authority. Commit `c113a88f` adds the dormant exact
helper attestation and bounded `execveat` status protocol; tests compile but
never execute the helper, runtime request/argv/environment remain unbound, and
no physical issuer or live authority is created. G1.7 still owns the private
co-located physical build issuer, containment v2/native adapter, and live
permanently non-promoting control owners,
human Phase A approval, sealed live negative/A/A controls, the human Phase B
final decision, current owner evidence, performance qualification, and the
separate human promotion decision. No live current control receipt, live
benchmark result, or performance result exists. After G2.1, the full harness
reports 667 total tests: 663 pass, one deliberate sealed-subject freshness gate
fails because it detects the committed G2.1 product paths, and three host-gated
tests skip. That expected freshness signal is neither a request/helper
regression nor green current-HEAD qualification.
G2.1 namespace metadata is implemented in `be08cf3b`; durable change delivery,
transaction-time SHACL validation, operational observability, statistics and
bounded join planning, full-text and spatial indexes, and federation planning
follow in that dependency order. Before G2.2 admits a new semantic-change
module, `HARNESS-CREATE-EXACT` task `task-1787935934614-ibmjn1` must complete
the schema-v2 exact new-file gate in ADR-0034. Commit `f3a0c127` adds exact
retained-FD binding for the eight-file ESM/launcher payload. Commit `c2cdde16`
freezes the dormant candidate-specific cgroup-v2/pidfd lifecycle contract.
Commit `23997c29` advances its Ruflo record to 88% by adding canonical
request/status replay and a compile-only static supervisor attestation; the
related matrix passes 210/210 and the Node 20 floor passes 50/50. The skeleton
is never executed, implements no parser/writer/mechanics, and grants no binding
or authority. Commit `88b9d7e7` advances the Ruflo record to 90% with the
separate successor FD-map v2, exact canonical launch capsule, bounded remap/
output/pidfd requirements, and an authority-null interactive control reducer.
The expanded related matrix passes 237/237 on both current Node and Node 20,
with three independent GO reviews for this dormant scope. Commit `7191ddde`
further specifies the boundary with exact FDs 18-25, a
CLOEXEC child outcome channel, held-stop `PTRACE_EVENT_EXEC` image proof, and
an in-band cancel-only bootstrap. Its retained-file claim is scoped to FDs
4-17, while live FDs 0-3, global writer ownership, freshness, guardian cleanup,
physical facts, binding, and all authority remain future requirements or
null/false. The focused successor tests pass 11/11 and the related non-G1.7
matrix passes 248/248 on current Node and Node 20 with three fresh GO reviews.
Commit `ab668ddd` adds ADR-0035's separate unregistered pure guardian-journal
contract with exact cancel-only state, canonical semantic/raw hashes, replay
anchors and bindings, null physical facts, and all-false authority. Its focused
suite passes 14/14, the expanded related non-G1.7 matrix passes 262/262 on
current Node and Node 20, the clean committed-code identity control passes 2/2
on both, and three independent reviews are GO for only this bounded pure scope.
Commit `040f3343` adds the separate local Linux x86-64 execution-copy fixture
for the attested preflight. It observes exact held-executable and FD0-19/FD0-17
structure, the three cancel-only terminal frames, Node close/post-reap behavior,
and thirty returned fail-closed scenarios. Focused tests pass 47/47 and all
top-level non-G1.7 tests except the separate committed-clean identity control
pass 495/495 on current Node and Node 20; that control passes 2/2 on both after
commit, and two fresh reviews are GO. Commit `fd9e4d05` then makes the exact
unavailable qualification check the first executable v2 action. The
`c9cb6423`/`997ad287`/`dfd6d92d` chain freezes the baseline, unique-`E0583`
evaluator, and one-`A`/one-`M` reference. Commit `f9ab7c72` adds only the
separate dormant-v2 profile, exact raw contract, production context binding,
and reference reconstruction. Commit `99f94fac` freezes a separate three-entry
dormant command-literal registry and pure resolver without executable CLI,
help, doctor, package, or provider reachability at that checkpoint. Commit
`f6897d34` adds exact application-receipt-v7 construction, verification, shared
worker-process proof evaluation, and private test-only replay while preserving
v1-v6. Commit `b915c5f6` wires only the hidden dormant CLI namespace and three
exact npm scripts. Each selector returns the fixed unavailable result with exit
4 before deferred parsing or effects. The completion checkpoint passes 99/99
focused and 724/724 top-level non-G1.7 tests on both current Node and Node
20.20.2; MetaHarness and Agentic-QE adapters pass 16/16 and 40/40. The Ruflo
record is complete at the dormant, authority-null boundary; ADR-0035's bounded local-
preflight task is complete. The active v1 registry remains nine tasks and 33
commands. Filesystem-backed native guardian/reaper durability and recovery,
delegated-cgroup evidence, race-free exec plus pidfd/waitid binding, the physical
adapter, full runtime closure, ADR-0039 host qualification, and ADR-0040 remain
open. The harness
gate is not G2.2 product progress, and ADR-0020 remains Proposed.

The open gates now have one-way ownership. ADR-0037 owns the sole statefs
policy/oracle and exact separately attested Linux x86-64 statefs-syscalls
object. ADR-0038 links that object unchanged and owns only the
manager/guardian/trampoline process/cgroup/exec mechanics. ADR-0034 owns dormant
application receipt v7, schema-v2 reconstruction/dispatch/profile literals,
and the early exact `executionGate: "native-containment-qualification-v1"` for
`contractSchemaVersion: 2`; ADR-0039 consumes those bytes unchanged and owns
only current-host qualification, receipt binding/activation, and path-executed
runtime closure. Readiness remains exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`. While it has
that value, the early gate precedes reconstruction workspace preparation and
performs no candidate/evaluator Git, submodule, process, provider, `ACCEPT`,
`REJECT`, receipt-emission, or Router-quality work; a later check remains
defense in depth. The qualified protocol would remain cancel-only, so G2.2 also
requires [ADR-0040's separately ratified commit-capable successor](../adr/0040-commit-capable-containment-decision-and-output-release.md).

The older ADR-0037 evaluator-first DAG is a historical 2026-09-03 snapshot.
Its S5 `task-1788399104822-pzsod1`, S6A
`task-1788399108388-65439n`, S6B `task-1788399112386-qn8psc`, S7
`task-1788399842562-kjszvk`, and released ADR-0038 S0
`task-1788399847418-arzwjy` rows were cancelled and superseded after contract
corrections; they are not current work. Replacement ADR-0037 S7 V3 task
`task-1788573342748-wln111` completed the bounded local, unregistered closure
at `acd09b61`. ADR-0038's replacement S0-S3B repository inputs are integrated
through `37a02bb2`, with parent reconciliation task
`task-1788589313411-vm7pg0` owning the current documentation and independent
review closure. ADR-0037 and ADR-0038 both remain Proposed; readiness,
qualification, production effects, and publication authority remain unchanged.

The dated 2026-09-02 ADR-0036 C15 checkpoint is GREEN through helper
`41dd2508`, guardian/fixture `23d37556`, and evaluator `4620dd92`. The live
exact-v2 helper, guardian, and v1 fixture identities are respectively
`194fb41e523b334206e91b2dfda8894f5e661a3d034b7330e3e6bd549e4c744e`,
`3b3af0e393ed2141a1623be324b20369231742f66bfd0f745b0307575fdc9718`,
and raw/canonical
`4f4433ed7e74a6076154d19139ffe79f8cf4a8fab4dbf0f5808a36fddf46dbdd` /
`7348640cbf1128447cea9af280e4c5eec4fbcdb5405055fa883a0c81cb462fe8`.
The same committed v1 fixture path advances live C15; historical C14 is
preserved only through evaluator-private reconstruction. Current Node 24.14.1,
exact Node 20.0.0, and Node 20.20.2 each pass direct 11/11, main 17 pass / zero
fail / two TODO, helper 20/20, and ADR verifier 1/1; independent review returned
APPROVE. The two TODOs are C16 private-store and C17 final aggregate, with
C18-C21 pending. This advances neither G2.2 nor the unresolved dual-host plan.
ADR-0036 remains Proposed, readiness remains exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`, and no
dependency, production runtime, qualification, promotion, publication, push,
or physical authority changes.

The dated 2026-09-02 ADR-0036 C16 private-store checkpoint is GREEN from RED
`5f717090fcc118d299cadf446fe0703026d360b6` to integrated commit
`930a7722490b8ad63d6825a25bd7bcb138140dd3`, tree
`2492ce6e2dd4f73e1c9749e657f05e09e71fd962`. Only the main and adversarial
evaluators changed; the C15 source, helper, fixture, runtime oracle, package,
lockfile, and dependency envelope is unchanged. The C16 receipt identity
`914baa75ad37e662895caf2002f98f395c47586bd8681d746ecd97820c7a18aa`
binds three stores, ten owners, five phases, and 50 unique controls. Its
three-entry registration inventory has zero registration TODOs at identity
`b91336686a76ed8b28d2b68dbc4f6739d60486a1ea03d30797d6980bcb5c04c9`.
Current Node 24.14.1, exact Node 20.0.0, and Node 20.20.2 each pass direct 11/11,
main 19 total / 18 pass / zero fail / one TODO, combined 30 total / 29 pass /
zero fail / one TODO, helper 20/20, and ADR verifier 1/1. Independent review
returned APPROVE with no findings. C17 final aggregate is the sole evaluator
TODO; C18-C21 remain pending. At the pre-documentation freeze, C16 task
`task-1788204847572-uh0olo` was recorded `in_progress` at 95%; its ledger
closure is a post-integration action, not evidence conferred by this plan. The
checkpoint advances neither G2.2 nor the unresolved
dual-host plan. ADR-0036 remains Proposed, readiness remains exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`, and it grants
no production, runtime, filesystem, process, cgroup, qualification, promotion,
publication, push, product, or physical authority.

The preceding paragraph is the historical C16 checkpoint. ADR-0036 C17 is
GREEN from evaluator-only RED `0bafc84dea56dd4e75fffa0546dcdcf48c2ea408`
to integrated commit `b037ed0a77575463d9babbe4ab43d8a17f0b4032`, tree
`64cb90bc403663436f91c268c2a3da04b76bf370`. Its stable final receipt
`eb548452b2f59a139730d11c0eb7046a2f0f4ab9c445e895ca5a7865382fb377`
binds four setup, 252 descriptor-alias, and 63 precedence calls: 319 monitored
calls, all 318 receipt mutations and all 25 behavioral classes killed, and zero
survivors. Current Node 24.14.1, exact Node 20.0.0, and Node 20.20.2 each pass
focused 20/20, direct 11/11, main 19/19, and combined 30/30 with zero TODOs.

C18 contract, C19 compatibility, and C20 security/mutation reviews each
independently returned APPROVE with zero blocking findings. C19 reproduced the
four test matrices plus the 13-export import-surface check and exact unavailable
readiness on all three runtimes. C20 kept distinct mutation denominators and killed 438/438 direct
hostile/static, 122/122 main expansion/oracle, 134/134 private-commit/
compatibility, 318/318 receipt, and 25/25 behavioral-class mutations, with
byte-exact restoration and zero survivors. Their repository-memory receipts
were read back before task closure. This evidence closes the ADR-0036 pure-ABI
implementation and independent-review boundary for exact `b037ed0a`; C21
reconciles local documentation and ledgers. The C17 package identity remains
historically exact for that commit; within its frozen identity set, later commit
`b915c5f6` changes only the engineering-harness package manifest by adding three
dormant exact-create scripts, with no dependency, engine, or lockfile change.
Commit `c01b3c6a` closes C21 task `task-1788204883871-l9tsh9` and programme
umbrella `task-1788042241332-xafq11` for the local documentation/ledger
boundary; both exact Ruflo rows and
`programme-evidence/adr0036-c21-local-closure-c01b3c6a-2026-09-03` were read
back. External Gist/main publication is transferred to pending task
`task-1788409495130-6ikk41`, with `gistUpdated:false` and `pushed:false` exact.
It advances neither G2.2 nor the unresolved dual-host plan. ADR-0036 remains
Proposed, readiness remains exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`, and no G1.7,
production, runtime, filesystem, process, cgroup, qualification, promotion,
publication, push, product, or physical authority is granted.

## Evidence policy

This plan distinguishes three evidence grades:

- **A — local proof:** source inspection, Git ancestry, compiled API, or a
  passing focused test in this repository.
- **B — first-party comparison:** current official Apache Jena, Eclipse RDF4J,
  W3C, or upstream Oxigraph documentation/source.
- **C — design inference:** a recommended Oxigraph product capability derived
  from A and B. It is not described as an existing competitor guarantee unless
  the first-party source says so.

Jena and RDF4J are comparison systems, not semantic authorities. The plan
copies useful observable guarantees and extension seams, not Java class
hierarchies, storage layouts, configuration grammars, or every server feature.

## Upstream integration audit

The merged upstream changes fall into these groups:

| Group                 | Incorporated changes                                                                                                                              | Local disposition                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| HTTP and CLI          | Repeated query arguments, content-negotiation specificity, truthful load failures, `--fail-on-named-graphs`                                       | Incorporated; fork protocol and graph-topology behavior retained                                                |
| Public API            | `Slice` field names, `QueryExpression`, `QueryDatasetSpecification`, documented substitution, `DocumentLoader`, custom scalar/aggregate functions | Incorporated and compiled across the workspace                                                                  |
| RDF and results       | RDF/XML invalid-QName rejection, XML result boundary whitespace, result fixture relocation                                                        | Incorporated; fork's RDF/XML writer and RDF version boundaries retained                                         |
| Evaluation            | Operator construction split, lazy error propagation, CONSTRUCT/MINUS fixes, reduced work after errors, join/order allocations                     | Incorporated; fork SERVICE SILENT and entailment adapters retained                                              |
| Optimization          | Literal equality, EXISTS/cartesian/union rewrites, recursive join optimization                                                                    | Incorporated with upstream regression fixtures                                                                  |
| CI/dependencies       | Actions, Python, CodSpeed, and workflow updates                                                                                                   | Incorporated where compatible with the fork workflows                                                           |
| Follow-up Graph Store | Atomic `PUT` replacement and selected-missing `POST` creation/status changes from `f9911902`/`ec68e3dd`                                           | Exact default rollback vector adopted; modular atomic handler and ADR-0014 selected-missing `POST=404` retained |
| Follow-up XML         | quick-xml 0.42 API migration for RDF/XML and SPARQL XML Results                                                                                   | Adopted with strict RDF namespace-extension and results namespace/version/duplicate/state validation retained   |
| Follow-up Python/CI   | Python >=3.9, abi3-py39, 3.14 artifact builders, PyPI-compatible wheels, and workflow changes                                                     | Adopted with `rdfs`/`owl2-rl` defaults and every fork QA job retained                                           |

No upstream commit in the audited range changed `lib/oxigraph/src/storage` or
introduced a public write adapter. The new write interface is therefore a fork
capability, not a delayed upstream port.

One merged test expected a stable row order from a query without `ORDER BY`.
The rewritten persistence plane exposed the valid reverse order. Commit
`f9033c2b` makes the test's ordering requirement explicit and the complete CLI
suite passes.

## Current capability map

### Already supported

Evidence grade A applies to this section.

- SPARQL Query and Update, including request-level rollback for the built-in
  store.
- SPARQL Graph Store writes with conditional requests and explicit empty graph
  topology.
- Memory and RocksDB stores, stable transaction snapshots, read-your-writes,
  atomic batch application, backup, bulk loading, and read-only open. Both
  built-in stores serialize writers. Their typed capability profiles remain
  conservative, and bounded cancellation/timeout currently covers transaction
  admission before snapshot creation rather than an already-started commit.
- Backend-neutral reads with `QueryableDataset`.
- Backend-neutral transactional writes with `TransactionalDataset` and
  `WritableDataset`.
- Generic SPARQL Update over a replacement persistence plane.
- Runtime-derived service descriptions whose SPARQL claims follow effective
  handlers, egress policy, and compiled transport rather than an RDF 1.2
  feature alone.
- RDF 1.1/1.2 modes, broad RDF I/O, JSON-LD, SPARQL result formats, and explicit
  version/media-type negotiation.
- Basic federated `SERVICE`, cancellation for query evaluation, and HTTP
  timeouts.
- GeoSPARQL functions, bounded Datalog/RDFS/OWL 2 RL, and dated fail-closed
  SHACL profiles.
- A broad differential/conformance harness and explicit graph-topology
  contract.

### Comparison baseline

- [Apache Jena 6.2.0](https://jena.apache.org/download/) is the current official
  Jena release used here. Its relevant first-party surfaces include
  [TDB transactions](https://jena.apache.org/documentation/tdb/tdb_transactions.html),
  [SHACL](https://jena.apache.org/documentation/shacl/),
  [text search](https://jena.apache.org/documentation/query/text-query.html),
  [RDF Patch](https://jena.apache.org/documentation/rdf-patch/),
  [GeoSPARQL](https://jena.apache.org/documentation/geosparql/geosparql-fuseki.html),
  [SERVICE controls](https://jena.apache.org/documentation/query/service.html),
  and the [Fuseki administration protocol](https://jena.apache.org/documentation/fuseki2/fuseki-server-protocol.html).
- [Eclipse RDF4J 6.0.1](https://rdf4j.org/news/2026/08/20/rdf4j-6.0.1-released/) is the current official
  stable RDF4J release used here. Relevant first-party surfaces include the
  [Repository API](https://rdf4j.org/documentation/programming/repository/),
  [RepositoryConnection contract](https://rdf4j.org/javadoc/latest/org/eclipse/rdf4j/repository/RepositoryConnection.html),
  [SAIL extension layer](https://rdf4j.org/documentation/reference/sail/),
  [transaction-time SHACL](https://rdf4j.org/documentation/programming/shacl/),
  [FedX](https://rdf4j.org/documentation/programming/federation/), and the
  [REST API](https://rdf4j.org/documentation/reference/rest-api/). The 6.0.1
  patch release follows the capability baseline documented in the
  [6.0.0 release notes](https://rdf4j.org/release-notes/6.0.0/). The rolling
  `latest` Javadoc may lag the download page's release label, so claims are
  limited to stable API concepts present in the cited contract.

## Gap matrix

| ID  | Capability                                 | This fork now                                                                                                                                                                                                                                                                                                                                                             | Jena 6.2                                                                                           | RDF4J 6.0.1                                                                                                                                                                       | Decision                                                                                                                    |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| G01 | Pluggable transactional write plane        | Implemented in `1da47285`; production adapter proof pending                                                                                                                                                                                                                                                                                                               | Dataset/transaction APIs, but not the same Rust extension need                                     | SAIL is the storage decoupling point                                                                                                                                              | Keep the narrow Rust traits; P0 conformance                                                                                 |
| G02 | Isolation and conflict contract            | Dimensioned requirements/capabilities are implemented; memory and RocksDB advertise a serialized-writer baseline proven by lost-update, write-skew, and 1/4/16-writer tests                                                                                                                                                                                               | TDB2 documents serializable transactions and one active writer                                     | Multiple requested levels and compatible-level discovery; documented MemoryStore/NativeStore SAILs use optimistic conflict failure, without implying every third-party store does | Retain serialization until G1.7 measurement justifies a separate OCC/TransactionDB hypothesis                               |
| G03 | Transaction lifecycle and uncertain commit | G1.4a adds a caller-keyed built-in `Store` path with typed committed/proven-absent/indeterminate outcomes and durable RocksDB lookup after reopen; G1.4b proves injected pre/post-write phase monotonicity and conservative lookup; memory deliberately does not claim durability; prepare, savepoints, active-state inspection, and crash/power-loss proof remain absent | Explicit transaction lifecycle                                                                     | `begin`, `isActive`, `prepare`, `commit`, `rollback`, unknown state                                                                                                               | Preserve the minimal lookup; G2.3a adds receipts/cursors and savepoints remain later scope                                  |
| G04 | Empty named-graph topology                 | Strong explicit contract across model, store, I/O, protocol, bindings                                                                                                                                                                                                                                                                                                     | Narrow observed divergence in the pinned Jena harness                                              | Context APIs; behavior depends on store/operation                                                                                                                                 | Preserve Oxigraph contract; no change                                                                                       |
| G05 | Prefix/namespace metadata                  | Parser prefixes are transient; store has no registry                                                                                                                                                                                                                                                                                                                      | Prefix mappings and a Fuseki prefix service                                                        | Transactional namespace operations                                                                                                                                                | P1 store metadata capability                                                                                                |
| G06 | Durable change delivery                    | None                                                                                                                                                                                                                                                                                                                                                                      | RDF Patch and patch-log ecosystem                                                                  | Connection/store listeners; notifications                                                                                                                                         | P1 ordered durable feed; RDF Patch adapter optional                                                                         |
| G07 | Commit receipt/idempotency                 | G1.4a can resolve a caller-supplied key as committed, proven rolled back, or indeterminate without replay, and G1.4b prevents marker-write errors from becoming a false rollback proof; there is still no semantic commit receipt, cursor, retention policy, or outbox                                                                                                    | Transaction/log internals, not an Oxigraph-compatible receipt                                      | Explicit unknown-transaction-state error                                                                                                                                          | P1 receipt and cursor, no silent replay                                                                                     |
| G08 | SHACL on write                             | Snapshot validation API; not a commit gate                                                                                                                                                                                                                                                                                                                                | SHACL Core/SPARQL and Fuseki validation endpoint                                                   | ShaclSail validates during commit                                                                                                                                                 | P1 pre-commit participant over staged view                                                                                  |
| G09 | Outbound `SERVICE`/`LOAD` policy           | G1.5 implements one deny-by-default policy for `SERVICE`, `LOAD`, and nested retrieval with typed policy failures, origin/IP allow controls, encoded/decoded byte ceilings, time/connection budgets, and remote-read cancellation                                                                                                                                         | SERVICE disable and endpoint-specific timeout/client controls                                      | HTTP client/federation controls                                                                                                                                                   | ADR-0019 implemented; retain one fail-closed egress boundary                                                                |
| G10 | Update-wide cancellation                   | G1.5b proves one token across validation, built-in writer admission, owned mutation, and the final pre-commit rollback boundary; G1.5c carries that exact control through negotiated custom-backend and `Store` admission; caller-owned rollback remains explicitly separate                                                                                              | Update timeouts and query abort controls                                                           | Query/FedX timeouts and circuit breakers                                                                                                                                          | Preserve the accepted negotiated binding; do not claim update-scoped rollback for a borrowed transaction without savepoints |
| G11 | Truthful service description               | G1.6 derives deterministic federation and remote-load disclosure from effective handlers, egress policy, and compiled transport; the exact seven-stage 4/17/1/1/12 verifier accepted the product and rejected all three controls                                                                                                                                          | Broad Service Description/Fuseki feature disclosure                                                | Repository metadata and protocols                                                                                                                                                 | ADR-0019 implemented; keep configured capability distinct from remote health/current admission                              |
| G12 | Operational metrics/admin                  | Logs and CLI operations; no stable stats/Prometheus/admin task surface                                                                                                                                                                                                                                                                                                    | Ping, stats, Prometheus, backup, compaction, tasks                                                 | Server/Workbench/Console and slow-query/circuit-breaker work                                                                                                                      | P1 metrics and recovery; multi-repo admin is a product choice                                                               |
| G13 | Backup/restore verification                | Backup and optimize exist; recovery is not continuously proven                                                                                                                                                                                                                                                                                                            | Live consistent backup and compaction administration                                               | Store-specific recovery tooling                                                                                                                                                   | P1 restore drills and receipts                                                                                              |
| G14 | Full-text indexing                         | No index or SPARQL extension                                                                                                                                                                                                                                                                                                                                              | Lucene text dataset and SPARQL property function                                                   | Lucene/Elasticsearch SAIL                                                                                                                                                         | P2 optional derived-index capability                                                                                        |
| G15 | Spatial indexing                           | GeoSPARQL functions; no persistent transaction-consistent spatial index                                                                                                                                                                                                                                                                                                   | GeoSPARQL module and spatial index management                                                      | GeoSPARQL support                                                                                                                                                                 | P2; preserve correctness without index                                                                                      |
| G16 | Federation planning                        | Basic `SERVICE`; no source selection, catalog, or federated plan metrics                                                                                                                                                                                                                                                                                                  | ARQ SERVICE controls and extensions                                                                | FedX source selection, joins, timeout, monitoring                                                                                                                                 | P2 after egress and statistics                                                                                              |
| G17 | Planner statistics                         | Query explain exists; no durable cardinality/statistics subsystem                                                                                                                                                                                                                                                                                                         | Mature ARQ/TDB planning                                                                            | Store estimates and FedX plan logging                                                                                                                                             | P2 statistics with correctness-neutral fallback                                                                             |
| G18 | Transaction participants                   | No stable validator/index/outbox hook                                                                                                                                                                                                                                                                                                                                     | Dataset wrappers/modules                                                                           | Stackable and notifying SAILs                                                                                                                                                     | P1 narrow change-set/participant API, not a class hierarchy                                                                 |
| G19 | Multi-repository lifecycle                 | One server process/store configuration path                                                                                                                                                                                                                                                                                                                               | Fuseki can manage multiple datasets                                                                | Server manages multiple repositories                                                                                                                                              | P3 product ADR; not a core RDF requirement                                                                                  |
| G20 | Protocol/file compatibility extras         | Standards-oriented formats and Oxigraph protocols                                                                                                                                                                                                                                                                                                                         | Jena-specific assemblers, RDF Thrift, patch endpoints                                              | RDF4J REST and Binary RDF                                                                                                                                                         | P3 only with a named interoperability user                                                                                  |
| G21 | Service identity and authorization         | No built-in principal or coarse server-operation authorization model; egress policy is not inbound authorization                                                                                                                                                                                                                                                          | Fuseki authentication/authorization hooks and dataset access controls                              | Server security plus repository/application authorization integration                                                                                                             | ADR-0026; fail closed, keep reverse-proxy versus embedded authority explicit, and do not claim SPARQL row/graph filtering   |
| G22 | Workload admission and operator resources  | Writer admission and egress budgets are narrow; no unified query/update queue, principal quota, or operator resource contract                                                                                                                                                                                                                                             | Fuseki metrics/tasks and server controls                                                           | Query circuit breakers, timeouts, slow-query logging, and resource-aware operators                                                                                                | ADR-0027; one composable budget context, bounded telemetry, no payload leakage                                              |
| G23 | Storage schema upgrades                    | RocksDB format versions fail closed, but there is no receipt-bound, crash-tested multi-step migration framework                                                                                                                                                                                                                                                           | TDB release/upgrade guidance and reload boundaries                                                 | Repository/configuration and native-store upgrade paths                                                                                                                           | ADR-0028 after verified backup/restore; simple additive migrations must still state old/new binary behavior                 |
| G24 | RDF4J REST interoperability                | SPARQL and Graph Store protocols exist; RDF4J repository REST paths, transactions, namespace endpoints, and error shapes are absent                                                                                                                                                                                                                                       | No RDF4J compatibility target                                                                      | Native Server/Workbench REST contract and client APIs                                                                                                                             | ADR-0029 defines an explicit versioned compatibility profile, not wholesale Java API emulation                              |
| G25 | Remote HTTP transactions                   | No server-side transaction lease protocol                                                                                                                                                                                                                                                                                                                                 | Fuseki/Jena transaction APIs are local/internal rather than this target contract                   | RDF4J REST exposes remote transaction lifecycle                                                                                                                                   | ADR-0030 defines the native lease state machine; ADR-0029 translates RDF4J requests onto it                                 |
| G26 | Multi-repository lifecycle                 | One configured store per server process                                                                                                                                                                                                                                                                                                                                   | Fuseki hosts and administers multiple datasets                                                     | RepositoryManager/Server manage multiple repositories                                                                                                                             | ADR-0031; privileged, resource-isolated lifecycle with receipt-bound delete/restore                                         |
| G27 | Incremental entailment projections         | Full snapshot evaluation and explicit one-shot materialization exist; no durable incremental projection, support state, applied-commit cursor, or recovery evaluator exists                                                                                                                                                                                               | Reasoner and inference facilities provide comparison outcomes, not this projection/cursor contract | Inferencer SAILs provide an extension comparison, not proof of equivalent durable projection semantics                                                                            | ADR-0032; rebuildable derived state with full-closure differential and cursor/recovery gates                                |
| G28 | Analytical/WCOJ execution                  | `sparopt` and `spareval` remain the only production planner/executor; there is no analytical cursor or WCOJ operator                                                                                                                                                                                                                                                      | ARQ/TDB planning is a workload comparison; no WCOJ-equivalence claim is made                       | Query algebra/evaluation and FedX provide comparison workloads; no WCOJ-equivalence claim is made                                                                                 | ADR-0033; disabled frozen experiment before any explicit or automatic promotion                                             |

## Target architecture

The domain boundaries are:

1. **Dataset query context** — read-only algebra evaluation through
   `QueryableDataset`.
2. **Transactional mutation context** — interactive quad and graph-topology
   changes through the new write traits.
3. **Bulk ingest context** — large input, batching, per-file atomicity, and
   explicit non-atomic modes.
4. **Commit governance context** — capability negotiation, writer-gate and
   validator orchestration, staged change sets, durable receipts, and
   post-commit delivery; validation semantics remain separately owned.
5. **Semantic-validation context** — version-pinned, network-free validation
   policy over the complete staged view.
6. **Derived-index context** — statistics, text, and spatial structures that
   must state whether they are synchronous, lagging, or rebuildable.
7. **Operations context** — health, metrics, backup, restore, compaction, and
   corruption validation.

The dependency spine is:

`write seam → conformance → capabilities/errors → staged change set → SHACL/feed/operations → statistics → text/spatial → federation`

Egress policy, complete cancellation, and service-description truthfulness can
proceed after the write seam and must close before exposing the server as a
hardened linked-data service.

## SPARC specification gate

### Functional requirements

- **FR-1:** Any persistence implementation can expose atomic RDF quad and graph
  topology mutations without depending on private Oxigraph storage types.
- **FR-2:** The complete SPARQL Update request observes its own prior writes and
  either commits or rolls back as one unit.
- **FR-3:** Each backend reports the transaction guarantees it can actually
  meet and returns typed failures for conflicts and uncertain outcomes; a
  durable transaction key resolves after reopen without replaying effects.
- **FR-4:** All outbound linked-data retrieval and federation uses one
  enforceable request policy and one cancellation model.
- **FR-5:** Commit-time validators, durable feeds, and derived indexes consume
  an explicit staged change set rather than intercepting unrelated APIs.
- **FR-6:** Server capability claims are generated from verified runtime
  capabilities rather than compile-time feature presence alone.

### Non-functional requirements

- **NFR-1:** The concrete `Store` fast path remains available and its hot-path
  regression stays within an explicitly approved performance budget.
- **NFR-2:** Public APIs preserve source compatibility where possible; any
  unavoidable break has a migration note and compile fixture.
- **NFR-3:** Security fixtures are loopback-only, deterministic, and cover
  redirects, resolution changes, resource bounds, and cancellation.
- **NFR-4:** Metrics and receipts exclude RDF payloads, credentials, and query
  text by default.
- **NFR-5:** Optional indexes may improve performance but may not silently
  weaken standard query correctness.

### Given/when/then acceptance criteria

- **AC-1:** Given an independent backend implementing the two public write
  traits, when a request performs `CREATE`, `INSERT DATA`, and
  `DELETE/INSERT WHERE`, then later operations see earlier writes and one
  commit publishes the exact final dataset plus empty-graph topology.
- **AC-2:** Given a request whose later update operation fails, when it is run
  through `on_dataset`, then every earlier quad and graph-topology change is
  absent and an explicit rollback failure, if any, remains in the error chain.
- **AC-3:** Given two concurrent writers whose updates conflict under the
  requested guarantee, when both attempt to commit, then the backend either
  serializes them consistently or rejects one with a typed conflict; it never
  reports both as safely committed after a lost update.
- **AC-4:** Given an untrusted `SERVICE`, `LOAD`, or JSON-LD context URL, when
  the target, redirect, resolution, size, media type, or duration violates
  policy, then retrieval is denied before commit and the transaction remains
  unchanged.
- **AC-5:** Given an endpoint without closed SPARQL 1.2 protocol receipts, when
  its service description is generated, then it does not advertise SPARQL 1.2
  merely because RDF 1.2 code was compiled.
- **AC-6:** Given a transaction-time SHACL policy, when staged data violates
  the pinned shapes/profile, then commit returns a typed validation report and
  publishes neither primary nor derived state.
- **AC-7:** Given an injected lost commit response, when the store is reopened
  and the transaction key is queried, then the lookup returns the atomically
  stored commit receipt or proves absence without replaying the transaction.

### Constraints and edge cases

- Transactions may stage large updates in memory; bulk ingestion retains its
  separate atomicity and resource contract.
- Commit transport failure can leave the durable outcome unknown; “unknown” is
  never rewritten as “rolled back.” The transaction key, commit ID, receipt,
  primary changes, and outbox position share one atomic durability boundary.
- External reads and custom functions make automatic replay unsafe unless an
  operation explicitly proves idempotency.
- Empty graph creation/removal must survive change capture even when no quad is
  inserted or deleted.
- Validation, feed, and index code must handle a graph being cleared and then
  recreated or dropped in the same transaction.
- A backend that cannot meet a minimum isolation or rollback requirement must
  reject transaction creation rather than degrade silently.

## Delivery plan

Sizes are relative engineering effort, not calendar promises: S is a focused
slice, M crosses a few modules, L is a new public subsystem, and XL is an
independently releasable programme.

The unfinished work is split by architectural ownership:

| Delivery work                                   | Owning ADR                                                                                                                                                                                                                      | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0.1-P0.2 conformance, guarantees, conflicts    | [ADR-0018](../adr/0018-transaction-guarantees-and-conflict-model.md)                                                                                                                                                            | Proposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P0.3-P0.4 egress, cancellation, service claims  | [ADR-0019](../adr/0019-unified-egress-cancellation-and-service-claims.md)                                                                                                                                                       | Implemented                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Persistent-backend adoption gate                | [ADR-0042 — Retain RocksDB and gate replacement-backend experiments](../adr/0042-retain-rocksdb-and-gate-replacement-backend-experiments.md)                                                                                    | Accepted 2026-09-05: RocksDB remains the only production-intended persistent backend; TurboKV is historical evidence only and is excluded from active implementation, comparison, and benchmarking                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P0.5 compatibility/performance promotion        | [ADR-0017](../adr/0017-repository-evolution-and-evidence-promotion-harness.md), [ADR-0018](../adr/0018-transaction-guarantees-and-conflict-model.md), [ADR-0019](../adr/0019-unified-egress-cancellation-and-service-claims.md) | Registry, rejection evidence, exact G1.4b binding, Darwin-free legacy replay, v6 two-phase/statistics semantics, v7 identity, pure owner/receipt-candidate replay, physical envelope/current-state replay, dormant containment, exact source-workspace construction, replay-only build claims, bounded cleanup, raw supervision, legacy-incompatible request v1/process v3, structural policy/request v2, and a compile-only dormant attested helper are implemented. The private issuer, containment-v2 native adapter, control/sample/qualification owners, human authorization, live controls, final approval, benchmark, qualification, and human promotion remain open |
| G1.7 private build issuer and physical owners   | [ADR-0041](../adr/0041-g17-private-co-located-build-issuer.md)                                                                                                                                                                  | Proposed future work. Bounded authority-null history through `2532c31e` is preserved; umbrella `task-1788638159292-7hkaf5` is pending and deferred at 60%. No successor slice is active, and this row does not gate R1 or direct product implementation                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P1.2 dormant schema-v2 harness pre-registration | [ADR-0034](../adr/0034-first-class-exact-new-file-admission.md)                                                                                                                                                                 | Proposed ADR with its implementation task complete at the dormant, authority-null boundary: early gate, exact-create chain, dormant profile/contract/context/reconstruction, receipt-v7/private replay, and hidden three-command CLI/package surface are implemented. Active v1 remains nine tasks/33 commands; hidden selectors exit 4 before effects and grant no product authority                                                                                                                                                                                                                                                                                       |
| Native containment implementation/qualification | [ADRs 0035–0039](../adr/README.md)                                                                                                                                                                                              | Proposed: ADR-0035's bounded local-preflight task is complete but the physical design remains open. ADR-0037's bounded local StateFS/manager interfaces and ADR-0038's authority-null S0-S3B repository inputs, including the one-use branded StateFS-transition consumer, are integrated through `37a02bb2`; the exact 23-file matrix passes 400/400 on Node 24.14.1 and exact Node 20.20.2. Non-StateFS transitions, C-side dispatch, physical process/cgroup integration, and ADR-0039 qualification/activation remain open. Readiness remains unavailable/native-adapter-unavailable                                                                                    |
| Commit-capable containment successor            | [ADR-0040](../adr/0040-commit-capable-containment-decision-and-output-release.md)                                                                                                                                               | Proposed; critical task `task-1788394167226-fxk7od` is pending. It owns durable decision-before-effect, at-most-once execution, descriptor-bound application output, exact recovery/receipt semantics, and distinct successor host qualification                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P1.2/G2.2 new semantic-change module            | [ADR-0020](../adr/0020-transactional-metadata-receipts-and-change-delivery.md)                                                                                                                                                  | Implemented G2.2 native capture and request/keyed integration behind focused product tests; ADR-0034, ADR-0039, and ADR-0040 apply only if the optional containment/qualification path is activated. It is not an R1 gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P1.1-P1.2 namespaces, effects, receipts, outbox | [ADR-0020](../adr/0020-transactional-metadata-receipts-and-change-delivery.md)                                                                                                                                                  | G2.1 namespaces and G2.2 native staged/request/keyed capture implemented; G2.3a-c durable receipts/outbox remain outstanding, so ADR-0020 remains Proposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P1.3 transaction-time SHACL                     | [ADR-0021](../adr/0021-transaction-time-shacl-validation.md)                                                                                                                                                                    | Proposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P1.4a-P1.4c readiness, backup, restore          | [ADR-0022](../adr/0022-operational-readiness-backup-and-recovery.md)                                                                                                                                                            | Proposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P2.1 statistics and bounded planning            | [ADR-0023](../adr/0023-statistics-and-bounded-join-planning.md)                                                                                                                                                                 | Proposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P2.2-P2.3 text and spatial indexes              | [ADR-0024](../adr/0024-rebuildable-derived-indexes.md)                                                                                                                                                                          | Proposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P2.4 explicit federation                        | [ADR-0025](../adr/0025-explicit-service-federation.md)                                                                                                                                                                          | Proposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P3.1 identity and authorization                 | [ADR-0026](../adr/0026-service-identity-and-authorization.md)                                                                                                                                                                   | Proposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P3.2 workload/resource governance               | [ADR-0027](../adr/0027-workload-admission-and-operator-resources.md)                                                                                                                                                            | Proposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P3.3 safe schema upgrades                       | [ADR-0028](../adr/0028-safe-storage-schema-upgrades.md)                                                                                                                                                                         | Proposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P3.4 RDF4J REST interoperability                | [ADR-0029](../adr/0029-rdf4j-rest-interoperability.md)                                                                                                                                                                          | Proposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P3.5 leased remote transactions                 | [ADR-0030](../adr/0030-leased-remote-http-transactions.md)                                                                                                                                                                      | Proposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P3.6 multi-repository lifecycle                 | [ADR-0031](../adr/0031-multi-repository-lifecycle.md)                                                                                                                                                                           | Proposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P3.7 incremental entailment projections         | [ADR-0032](../adr/0032-incremental-entailment-projections.md)                                                                                                                                                                   | Proposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P3.8 analytical/WCOJ research                   | [ADR-0033](../adr/0033-analytical-wcoj-execution.md)                                                                                                                                                                            | Proposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

P3 now has named user outcomes and separate decisions. It remains outside the
core write-interface acceptance boundary and is not silently absorbed into
[ADR-0018 — Transaction guarantees and conflict model](../adr/0018-transaction-guarantees-and-conflict-model.md) through
[ADR-0025 — Explicit SERVICE federation](../adr/0025-explicit-service-federation.md).

ADR-0017's two post-G1.6 harness controls are now closed independently. Commit
`4a15caa07df37d884e7c74d4b69c0505ce3de6e1` makes the canonical task and
command registries authoritative; commit
`afe30c7de7e3df6e72a0a855d83efc612339f261` adds replay-verified application
receipt v6 rejection evidence without granting Router quality. Both controls
remain local-only and non-promoting. G0.6 and G0.7 subsequently closed their
scoped mutation and claim-reconciliation checkpoints; those closures do not
complete ADR-0018 or the G1.7 compatibility/performance promotion gate.

### Slice 0 — upstream and write seam (complete)

| Task                                        | Dependency | Size | Acceptance                                                                                                                                                                             |
| ------------------------------------------- | ---------- | ---: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D0.1 Merge upstream through `8dcfb6b6`      | none       |    L | Git ancestry contains all 32 commits; affected baseline suites pass                                                                                                                    |
| D0.2 Add transactional dataset traits       | D0.1       |    M | External fake backend compiles; graph topology and read-your-writes are explicit                                                                                                       |
| D0.3 Bind generic SPARQL Update             | D0.2       |    M | Whole request commits atomically or rolls back; custom errors survive                                                                                                                  |
| D0.4 Preserve built-in performance path     | D0.3       |    S | Concrete `Store` write-only path remains; legacy update suite passes                                                                                                                   |
| D0.5 Stabilize unordered upstream test      | D0.1       |    S | Query states `ORDER BY`; CLI is 144/144                                                                                                                                                |
| D0.6 Reconcile service-description claims   | D0.1       |    S | Default and RDF 1.2 builds advertise only receipted SPARQL 1.0/1.1 capabilities                                                                                                        |
| D0.7 Audit merge through `ec68e3dd`         | D0.1       |    L | Merge `e9d2db1b` is a two-parent ancestor; Rust, Python, workflow, and 409/0/2 harness evidence passes while ADR-0014 divergence remains bound                                         |
| D0.8 Refresh maintenance through `786d0017` | D0.7       |    S | Patch-equivalent `d5343f6b`/`c86772a9` update eight action pins and three JavaScript lock resolutions; stable patch IDs and lockfile dry-run pass, with no Rust/product-semantic delta |

### P0 — make the write contract trustworthy

#### P0.1 Shared backend conformance kit — L

Dependencies: Slice 0.

- Define a reusable adapter test suite for memory, RocksDB, and the test-only
  `RewrittenPersistencePlane` portability adapter.
- Exercise every graph selector, empty named graphs, duplicate inserts,
  deletion of absent quads, `CREATE`/`CLEAR`/`DROP`, `DELETE/INSERT WHERE`,
  `LOAD`, commit, rollback, and drop-without-commit.
- Add injected failures at transaction open, read iteration, mutation,
  rollback, and commit.
- Add model-based operation sequences and compare the final dataset plus graph
  topology, not only quad sets.

Acceptance:

- The same conformance crate runs unchanged against all three backends.
- Any future production persistence adapter runs that unchanged kit before
  adoption. The absence of a third production adapter is operational-realism
  debt for programme QA, not an unconditional ADR-0018 completion blocker.
- No failed SPARQL Update operation leaks data or graph membership.
- Read-your-writes and external isolation are tested with concurrent handles.
- An implementation that conflates `CLEAR` and `DROP` demonstrably fails.

#### P0.2 Capabilities, isolation, and typed failures — L

Dependencies: P0.1.

- Add an explicit transaction request/options type and capability report.
- Represent at least read-only/read-write mode, effective isolation guarantee,
  conflict detection, rollback support, and durable-commit support.
- Fail when a requested minimum guarantee cannot be met; do not silently choose
  a weaker level.
- Classify conflict, read-only, cancellation, unavailable, corruption,
  rollback failure, and indeterminate commit separately.
- Preserve the original source error and keep the existing `StorageError`
  compatibility mapping.
- Do not automatically replay a transaction containing `LOAD`, `SERVICE`,
  custom functions, or other potentially non-idempotent work.

Acceptance:

- Concurrent lost-update/write-skew fixtures document the guarantee of each
  backend.
- Start with a shared RocksDB writer gate if those fixtures expose anomalies;
  acquire it with a bounded, cancellable wait before snapshot creation and hold
  it until commit, rollback, or transaction drop. Concurrent readers must stay
  unblocked. Evaluate `TransactionDB` or optimistic conflicts only behind a
  separate benchmarked hypothesis.
- Conflict tests return a typed conflict and never a generic string.
- A simulated lost commit response returns “outcome unknown,” not “rolled
  back”; after reopen, transaction-key lookup returns committed or proven
  absent without replaying effects.
- Existing `start_transaction()` remains source-compatible through explicit
  defaults or a documented migration.

#### P0.3 Cancellation and external-request policy — L

Dependencies: Slice 0; coordinates with P0.2 error types.

- Use one injectable outbound policy for SPARQL `SERVICE`, SPARQL `LOAD`, and
  remote JSON-LD contexts.
- Control schemes, methods, host allow/deny rules, resolved IP ranges, DNS
  rebinding, redirects, credentials, content type, response bytes, and time.
- Check cancellation in all update loops, before and after external I/O, and
  before commit.
- Make CLI/server defaults explicit and safe for untrusted requests; retain an
  opt-in federation profile for intended deployments.

Acceptance:

- Loopback, link-local, private-network, redirect, oversized-body, slow-body,
  and DNS-change fixtures are deterministic and do not require the public
  internet.
- Cancelling `INSERT DATA`, `DELETE DATA`, `DELETE/INSERT`, or `LOAD` leaves the
  dataset and graph topology unchanged.
- A policy rejection is distinguishable from a network or RDF parse error.

#### P0.4 Capability-derived service descriptions — M

Dependencies: P0.2.

- Build on the conservative ADR-0011 baseline restored in `7dc190d3`.
- Generate any future expanded claims from runtime-closed capability receipts
  rather than a Cargo feature alone.
- Keep SPARQL 1.2 family claims suppressed until the required protocol
  receipts close while retaining accurate parser/evaluator APIs.
- Test query-only, update-only, read-only, federation-disabled, RDF 1.1, RDF
  1.2 Basic, and RDF 1.2 profiles.

Acceptance:

- No build advertises a capability that its endpoint fixtures do not prove.
- The service-description matrix is exact, duplicate-free, and stable under
  serialization format changes.
- ADR-0011 and executable tests state the same policy.

#### P0.5 Compatibility and performance qualification — deferred, claim-specific

This historical G1.7 evidence is preserved, but ADR-0043 removes it from the R1
critical path. Resume it only for an explicitly authorized compatibility or
performance claim; it is not a prerequisite for direct product work.

The local G1.7 control preserves outer qualification receipt v1 and now uses
exact contract v7 `42ed3867...`. Its control authorization `31b8fce5...` and
final decision set `b0def4f0...` are proposed/unapproved; `run` exits 4 at
`CONTROL_AUTH_PROPOSED` before identity, evidence, build, runtime-directory
creation, or sampling and writes no G1.7 run. Pure Agentic/native replay over
synthetic fixtures now includes bounded canonical control-receipt candidate
replay in `45121da9`. It is non-eligible and binding-null. Commit `fbbb692b`
adds the separate exact write-once, receipt-last physical envelope and
current-state sealed replay. Seal returns no binding; only replayed PASS may
derive a prospective final-decision binding, and every authority flag remains
false. It proves the observed owner sequence and current archive state, not a
live owner, replay reconstruction of historical receipt-last order,
crash/power-loss/filesystem-flush durability, or same-UID tamper resistance.
Commit `f04b9bc7` adds dormant containment, `a457f46c` adds the exact execution
plan and source-workspace materializer, `c5687dac`/`3688ccda` add replay-only
Cargo/build evidence, `da41d7e0` freezes the exact non-tmpfs mount-namespace
path policy, `3b289522` bounds destructive cleanup, and `c5050e9c` adds raw
process supervision. Commits `13afa94d`/`3f8951e3` add the permanently
launch-ineligible request-v1 boundary, and `8b2c6366` adds replay-only
process-evidence v3; both are legacy-incompatible with the successor path.
Commits `ef869cf4`/`466d2d78` and `75a07693` add structural policy/request v2,
and `c113a88f` adds an attested dormant helper whose tests compile but never
execute it. These artifacts remain binding-null and authority-free and do not
supply live G1.7 build/control execution provenance or promotion authority.
Ruflo map v15 records completed pure task `task-1787892615000-rdwz7q`, completed
physical task `task-1787896401667-xookiy`, and its historical corrected G1.7
checkpoint at 60%. The overarching G1.7 task
`task-1787871483413-ki34q2` is pending and deferred at 74%; supporting
workspace/build task `task-1787902127894-7n7vk3` is pending at 93%, and
containment task `task-1787902138074-0w648x` is pending at 92%. ADR-0035's
bounded local-preflight task
`task-1788002473147-nsat6x` is complete; its broader Proposed physical design
remains open. ADR-0040 task `task-1788394167226-fxk7od` is pending.
Replacement-backend decision task `task-1788074788516-p5tvdm` records the
ADR-0042 evidence-backed defer/reject result: retain RocksDB, select no
replacement adapter, and grant no experiment, benchmark, migration, or
production authority.
ADR-0041 remains Proposed. Its V2 umbrella task
`task-1788403413560-sedu3a` is cancelled/superseded historical evidence and
grants no live G1.7, host, provider, qualification, promotion, or publication
authority. Documentation-only S0 `task-1788403444941-5l8jci`, S1 evaluator
`task-1788403485637-t9wn40`, and pure S2 requirements
`task-1788403489170-xl71j9` are complete and authority-null. The exact V2 IDs,
edges, cancelled history, and activation blockers remain recorded at
`task-plans/adr-0041-evaluator-first-dag-v2-2026-09-03`. Current Graph-V5
umbrella `task-1788638159292-7hkaf5` carries that evidence unchanged; its exact
map is stored at
`task-plans/adr-0041-private-build-issuer-graph-v5-2026-09-05`. S3A
`task-1788638011523-4c24e5` froze the dormant source-absent evaluator at
`a5f2442f`; S3B `task-1788638033847-mlvsbe` added the dormant authority-null
source at `2532c31e`. No successor pair is active under ADR-0043. S4A
`task-1788638038970-05pyb8` separately waits for exact ADR-0039 and
ADR-0040 successor interfaces before amending the evaluator. S4B
`task-1788638043966-3guruj` retains current same-host/same-boot exact-artifact
qualification, receipt-bound activation, and explicit isolated-host/G1.7
Phase A authorization. The umbrella cannot close until the separately
authorized S9D host-result review also passes.
Legacy v1/v3/v4/v5/v6 replay is Darwin-free and `LEGACY_REPLAY_ONLY`.

The accepted G1.4b receipt is copied byte-for-byte, hash-bound, and pure-replayed
at the current prerequisite boundary; its projection/binding is
`d57eb7cb...`/`5a4f5721...`. Contract v7 preserves v6's ordered two human
phases and freezes authorization-bound canonical sample bytes, paired 10%
negative-control non-inferiority, shared-seed two-direction 5% A/A equivalence,
the inclusive 5% MAD boundary, and mechanical verdict precedence: first
authorize only permanently non-promoting negative and
independently built A/A controls and seal/replay their raw owner receipt; then
bind that receipt, its observed signature, and the G1.4b prerequisite into the
final atomic reference/performance/noise decision before any subject/reference
sample. No human approval or control execution has occurred. Current owner
evidence, the benchmark, qualification, and the later human
promotion decision remain open. There are no performance results.

- Benchmark built-in `on_store` before/after and generic `on_dataset` on memory
  and disk.
- Run the W3C, fork semantic, Jena differential, RDF 1.1, RDF 1.2, read-only,
  and Graph Store lanes.
- Add a merge audit that flags future upstream edits to update, dataset, store,
  service-description, or HTTP loading seams.

Acceptance:

- No material regression is accepted without an explicit budget and ADR.
- Every public transaction guarantee has at least one negative test.

### P1 — govern commits and operate the store

#### P1.1 Namespace registry — M — Implemented

Dependencies: P0.2.

Implemented in `be08cf3bbcb836ec46df2b864d31e80f5b837b52`. The default-feature
evaluator passes 13/13 across memory, RocksDB, and the test-only rewritten
persistence plane; the `--no-default-features` evaluator passes 8/8 across
memory and the rewritten plane. Focused
regressions pass `store` 26/26, `transaction_outcomes` 7/7,
`transaction_state_model` 3/3, and `transactional_dataset` 3/3; the
no-default-feature library check passes. Store-level RocksDB set/remove/
range-clear, preservation of RDF/topology, and reopen are included. The
pre-existing minimal transaction trait file remains byte-identical at SHA-256
`ae84a63b060400845cd965828cb314a2ac9fc7da3d30655a1a7603af6c924e55`.

- Add `NamespacePrefix`, `Namespace`, and a separate
  `WritableNamespaceRegistry: WritableDataset` capability for prefix-to-IRI
  mappings. Keep `WritableDataset` and `TransactionalDataset` byte-identical;
  generic persistence planes opt in on their transaction type without a second
  transaction opener.
- Use the empty default prefix or exact Turtle/SPARQL `PN_PREFIX` grammar,
  preserving UTF-8 without Unicode normalization. Store one IRI per prefix,
  permit duplicate IRIs, and iterate in exact ascending prefix order.
- Make namespace changes transactional when mixed with RDF writes. Memory uses
  the existing MVCC log/version boundary, not a side map. RocksDB uses locally
  versioned reserved records in the existing default column family, with no new
  column family or global storage-version bump; legacy marker absence is an
  empty registry and malformed or unknown records are corruption.
- Keep RDF clear and namespace clear independent. Parser/load prefixes remain
  transient unless explicitly stored, and registry prefixes are not injected
  implicitly into SPARQL parsing or dumps. Serializer prefix configuration is
  explicit opt-in.

Acceptance:

- A frozen public evaluator passes unchanged against memory, RocksDB, and a
  test-only rewritten persistence plane for mixed and namespace-only commit,
  read-your-writes, isolation, explicit/drop rollback, overwrite, remove,
  clear, ordering, default/Unicode/invalid prefixes, and keyed outcomes.
- Prefix metadata never changes reconstructed RDF dataset equality or graph
  topology; RDF clear preserves prefixes and namespace clear preserves RDF.
- Parser/load declarations, SPARQL parsing, and dumps have no implicit registry
  effects. Serializers can opt in deterministically and may reject mappings a
  format cannot represent.
- RocksDB legacy open, reopen, read-only open, and corrupt/unknown record cases
  fail or succeed exactly as ADR-0020 specifies.

#### P1.2 Staged change sets, commit receipts, and durable feed — XL

Dependencies: P0.1 and P0.2. The
[ADR-0034 exact new-file harness gate](../adr/0034-first-class-exact-new-file-admission.md)
is implemented as a dormant unavailable surface under Ruflo task
`task-1787935934614-ibmjn1`; the existing-file algebra design may be refined in
parallel, but no new module enters a frozen candidate before activation.
Admission also requires current
[ADR-0039 host qualification](../adr/0039-delegated-host-containment-qualification-and-readiness.md)
and [ADR-0040's commit-capable successor](../adr/0040-commit-capable-containment-decision-and-output-release.md)
because the qualified containment protocol specified today is cancel-only.

- Record normalized quad, graph-topology, and namespace changes in the
  transaction.
- Put the semantic-change algebra in a focused module after exact creation is
  available; no product file, empty or otherwise, may be pre-created and
  `store.rs` may not be expanded to bypass the gate.
- Define a storage-issued opaque commit ID and a durable receipt that
  distinguishes committed, rejected, and indeterminate outcomes.
- Commit the transaction key, commit ID, receipt, primary changes, and a
  cursor-addressable outbox atomically.
- Deliver an ordered at-least-once feed; consumers deduplicate by commit ID and
  event position.
- Version and checksum feed records; define retention, cursor leases and
  expiration, slow-consumer backpressure, and backup/compaction interaction.
- Provide RDF Patch serialization as an adapter after the native receipt/change
  model is stable.

Acceptance:

- Crash tests cover before commit, during commit, after durable commit but
  before response, and during feed delivery.
- A consumer can resume from a cursor without silently skipping committed
  changes.
- Lost-response lookup after reopen proves committed or absent without
  replaying effects. Restart, retention advance, cursor expiration, and slow
  consumers have typed outcomes and no silent gaps.
- Blank-node identity and empty graph creation/removal round-trip through the
  native feed; large clear/drop need not expand synchronously, and the RDF
  Patch adapter documents its blank-node system-ID policy.

#### P1.3 Transaction-time SHACL — L

Dependencies: P1.2; uses existing `oxshacl` profiles.

- Add an in-process pre-commit validator over the staged transaction view.
- Pin the shapes graph, profile, inference setting, timeout, and result limit in
  transaction options or store policy.
- Keep validation network-free, bounded, and fail-closed. External policy
  shapes are version-pinned at begin; a shapes graph changed by the same
  transaction is read from the resulting staged view and forces full
  validation.
- Treat validation reports as typed commit rejection and roll back all RDF,
  topology, namespace, and derived-state changes.
- Define concurrency semantics when separate transactions are jointly invalid;
  use the effective isolation/conflict layer rather than ad-hoc replay.

Acceptance:

- Valid and invalid insert/delete/topology changes are tested.
- Shape changes and data changes in the same transaction have a defined order.
- Incremental validation is accepted only after continuous differential proof
  against the full staged-view validator.
- Concurrent validation fixtures cannot jointly commit a known-invalid state
  under the advertised validation profile.
- Timeout or validator failure fails closed without partial commit.

#### P1.4a Metrics, readiness, and circuit breakers — M

Dependencies: P0.2 and P1.2.

- Expose stable counters and latency/error histograms for queries, updates,
  commits, conflicts, rollback failures, external policy denials, validation,
  feed lag, and index lag.
- Add loopback health/readiness endpoints separately from privileged
  maintenance operations and define circuit-breaker/degraded-mode behavior.
- Define one canonical zero-or-more derived-state contributor registry shared
  by readiness, backup, and restore. Empty is valid; a test-only contributor
  proves the nonempty path.

Acceptance:

- Prometheus output, if chosen, has bounded labels and no query text, RDF data,
  credentials, or user identifiers by default.
- Health does not report ready when the writer, durable feed, or required index
  is unrecoverably unavailable.
- Unknown, duplicate, missing-required, or cursor-incoherent contributors fail
  closed; requiredness is profile-owned and cannot be downgraded by a provider.

#### P1.4b Backup receipts and creation — M

Dependencies: P1.2 and P1.4a.

- Start with a checkpoint-plus-manifest design. Bind store UUID, schema
  version, source commit ID, RocksDB sequence, authoritative-outbox cursor, the
  canonical contributor inventory, file inventory/checksums, start/end state,
  and a completion marker.
- Exercise compaction/optimize with concurrent reads and blocked or rejected
  writes according to its documented contract.

Acceptance:

- Interrupted backups never carry a completion marker or pass receipt
  verification.
- Backup, retention, outbox, contributor cursors, and compaction advance without
  an unrecorded consistency gap.

#### P1.4c Restore verification and drills — M

Dependencies: P1.4b.

- Restore into a fresh directory, open the store, run its storage validator,
  and verify topology, namespaces, outbox position, and every declared
  contributor.
- Baseline and receipt recovery-point and recovery-time objectives.

Acceptance:

- Automated drills compare the restored store with the source snapshot
  receipt and report numeric RPO/RTO.
- Missing files, checksum drift, incomplete manifests, and cursor mismatches
  fail closed before readiness.

### P2 — add indexed and federated capabilities

#### P2.1 Statistics and bounded join planning — XL

Dependencies: P1.2 and P1.4a-P1.4c.

- Add bounded, rebuildable exact graph/predicate counts, sketches, and top-K
  statistics with freshness metadata.
- Instrument estimated/actual rows and q-error. Use bounded dynamic programming
  for small basic graph patterns and a deterministic greedy fallback.
- Keep the existing heuristic planner as a correctness-neutral fallback; stale
  or missing statistics may change performance only.

Acceptance:

- Frozen BSBM/WatDiv/LDBC subsets record p50/p95 q-error, intermediate rows,
  planning time, and per-query tail regressions on pinned hardware/config.
- Planner fallback returns identical results when statistics are absent,
  corrupt, or stale.

#### Shared P2.2/P2.3 prerequisite (G3.0) — XL

Dependencies: P1.2 and P1.4a-P1.4c.

- Implement one provider-neutral lifecycle with versioned provider/schema
  identity, source/applied commits, checksummed crash-safe generations, bounded
  rebuild/delta processing, atomic activation, cancellation/resource ceilings,
  lag/readiness, and ADR-0022 backup/restore contributions.
- Prove the lifecycle with a fake provider before selecting text or spatial
  engines. G3.0 consumes the G2 contributor hook; G2 does not depend on G3.0.

Acceptance:

- Crash, corruption, cancellation, rebuild, activation, backup, and restore
  matrices fail closed without making a partial generation active.
- The same lifecycle contract is reused unchanged by P2.2 and P2.3.

#### P2.2 Full-text index — XL

Dependencies: G3.0 and preferably P2.1.

- Define an index provider and a small SPARQL extension surface without making
  Lucene or Elasticsearch types part of the core API.
- Use a rebuildable asynchronous outbox consumer with an applied-commit cursor,
  or separately justify synchronous atomic updates.
- Support language-aware fields, graph scoping, score, limits, rebuild, and
  consistency checks.

Acceptance:

- Insert, delete, clear, drop, rollback, crash, and rebuild fixtures preserve
  query correctness.
- Strict queries wait for `applied_commit >= required_commit`, execute an
  authoritative fallback scan, or return typed `IndexNotFresh`; primary-state
  verification removes stale candidates but is not mistaken for recovering
  missing additions. Eventual results are explicitly opt-in.

#### P2.3 Spatial index — L/XL

Dependencies: G3.0 and existing `spargeo` correctness tests.

- Index per-CRS geometry envelopes. Transform/normalize only where exact
  transformation semantics and error bounds are proven.
- Integrate mutation, rollback, graph lifecycle, rebuild, and corruption
  detection through the same derived-state contract as text.
- Keep an exact non-indexed evaluation path as the correctness oracle.

Acceptance:

- Indexed and oracle results agree for the supported GeoSPARQL profile.
- Updates never require a server restart to become visible unless an explicitly
  selected asynchronous mode reports its lag.

#### P2.4 Explicit `SERVICE` federation planner — XL

Dependencies: P0.3 and P2.1 for embedded/research work; additionally P0.4 for
advertisement; additionally P3.1 and P3.2 for server exposure or promotion.

- Add endpoint catalogs, source selection, join strategies, per-endpoint
  budgets, cancellation, and explain/metrics for federated plans.
- Treat remote endpoints as untrusted and route every request through P0.3.

Acceptance:

- Federation tests use controlled local endpoints for failure, timeout,
  partial-stream, `SILENT`, and cancellation cases.
- Transparent implicit federation and cross-endpoint transactional federation
  remain later, separately approved product hypotheses.

### P3 — explicit linked-data platform decisions

The programme now records the named decisions admitted by this user:

- ADR-0026: service identity and authorization;
- ADR-0027: workload admission and operator resource governance;
- ADR-0028: safe storage schema upgrades;
- ADR-0029: a versioned RDF4J REST interoperability profile;
- ADR-0030: leased remote HTTP transactions;
- ADR-0031: multi-repository lifecycle;
- ADR-0032: incremental entailment projections; and
- ADR-0033: an optional analytical/worst-case-optimal research path.

Their executable order and exit gates are G4.1-G4.8 in the
[linked-data-store evolution harness plan](linked-data-store-evolution-harness-plan.md).
They do not authorize Jena assembler/module compatibility, RDF Patch HTTP
compatibility beyond the native feed adapters, Binary RDF, RDF Thrift,
distributed transactions, clustering, or automatic cross-node failover.
None is necessary to accept ADR-0016 or to call the core an embeddable linked
data store.

[ADR-0034 — First-class exact new-file admission](../adr/0034-first-class-exact-new-file-admission.md)
is an optional engineering-harness prerequisite, not a P3 product feature and
not an R1 or direct-product gate. It owns the dormant receipt-v7/schema-v2
pre-registration and early qualification gate for that harness path. The early
gate plus separate dormant profile, contract, context, and
reconstruction exist through `f9ab7c72`; the dormant command literals are
frozen in `99f94fac`; receipt v7/private replay is frozen in `f6897d34`; and
hidden unavailable-gated CLI/package wiring is frozen in `b915c5f6`.
None grants linked-data-store capability by itself.
ADR-0037 and
ADR-0038 separately own statefs/syscalls and native process mechanics;
ADR-0039 owns host qualification/activation only. If that optional path is
resumed, it cannot release application output until
[ADR-0040's separately ratified commit-capable successor](../adr/0040-commit-capable-containment-decision-and-output-release.md)
replaces the cancel-only protocol. ADR-0043 allows a directly implemented and
natively tested G2 product slice to proceed without activating this path.

## SPARC execution framing

Each unfinished task uses the same evidence cycle:

1. **Specification** — state the observable guarantee, exclusions, error
   taxonomy, compatibility effect, and evidence authority.
2. **Pseudocode** — enumerate transaction states and failure points before API
   design; include crash and cancellation paths.
3. **Architecture** — assign the behavior to one bounded context and record an
   ADR for new public seams or operational guarantees.
4. **Refinement** — implement the smallest vertical slice behind negative
   tests, then run semantic, mutation, concurrency, and performance gates.
5. **Completion** — produce a commit, exact commands/results, capability
   receipt, rollback/migration note, and updated gap state.

## R1 release gates

R1 requires the gates that exercise its changed product and binding surfaces:

- `cargo fmt --all -- --check` and `git diff --check`;
- the affected `spareval` and `oxigraph` suites, including transactional
  writes, topology, merged-default behavior, and SPARQL term-version policy;
- the pinned Oxigraph SPARQL conformance lane;
- affected JavaScript and Python binding tests;
- the required query/update evaluator fuzz targets; and
- a reachable submodule graph before claiming clone reproducibility.

Strict Clippy, workspace all-target checks, Jena differentials, Agentic-QE,
mutation, MetaHarness qualification, live G1.7, and benchmarks apply only when
the release makes their corresponding compatibility, qualification, or
performance claim. They are not universal R1 gates.

The `rocksdb-pkg-config` all-features lane requires a system `rocksdb.pc` and is
an environment prerequisite, not evidence that the vendored RocksDB lane
failed. CI should run vendored and system-library lanes separately.

## Risks and controls

| Risk                                                           | Control                                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Public GAT traits become difficult to evolve                   | Keep the first trait minimal; add optional extension traits/capability objects; add compile fixtures for external implementers |
| Backend advertises guarantees it does not implement            | Conformance kit plus explicit effective capabilities; fail closed on unmet minimums                                            |
| Commit failure is mistaken for rollback                        | Typed indeterminate outcome and durable receipt lookup                                                                         |
| Automatic conflict retry duplicates external effects           | No implicit replay; retry only an explicitly replay-safe operation with an idempotency key                                     |
| SHACL or indexes create a giant storage trait                  | Staged change-set/participant context with narrow responsibilities                                                             |
| Derived index drifts after crash                               | Atomic participation or durable outbox, lag metric, rebuild and oracle comparison                                              |
| Egress policy is bypassed by redirect or DNS change            | Validate every resolution and redirect; pin/connect safely; bound bytes and time                                               |
| Metrics leak RDF/query content or create unbounded cardinality | Metadata-only defaults, bounded labels, privileged diagnostics                                                                 |
| Competitor parity expands without bound                        | Require an observable user outcome and an ADR; keep Java API/file-format compatibility out of core                             |
| Future upstream merge overwrites fork semantics                | Path-based merge audit plus focused semantic tests and ADR review                                                              |

## Research and Ruflo ledger

The research began with three comparison evidence tracks. Later gated decision
and governance records are persisted beside them in the repository's Ruflo
memory:

| Track                                   | Ruflo task                                                                                                                                                                                                                                                                                                | Evidence pointer                                                                                                                                                                                                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upstream/write architecture             | `task-1787593372180-0hjfvi`                                                                                                                                                                                                                                                                               | `research/oxigraph-2026-08-24-r1-upstream-write`                                                                                                                                                                                                                                             |
| Apache Jena comparison                  | `task-1787593372163-lmmndv`                                                                                                                                                                                                                                                                               | `research/oxigraph-2026-08-24-r2-jena-gap`                                                                                                                                                                                                                                                   |
| Eclipse RDF4J comparison                | `task-1787593372137-3j8kyo`                                                                                                                                                                                                                                                                               | `research/oxigraph-2026-08-24-r3-rdf4j-gap`                                                                                                                                                                                                                                                  |
| Replacement-backend decision            | `task-1788074788516-p5tvdm`                                                                                                                                                                                                                                                                               | [ADR-0042 — Retain RocksDB and gate replacement-backend experiments](../adr/0042-retain-rocksdb-and-gate-replacement-backend-experiments.md); Accepted RocksDB-retention decision, with TurboKV history preserved but no active implementation, comparison, benchmark, or adoption authority |
| Exact new-file admission / G2.2         | `task-1787935934614-ibmjn1`                                                                                                                                                                                                                                                                               | [ADR-0034 — First-class exact new-file admission](../adr/0034-first-class-exact-new-file-admission.md)                                                                                                                                                                                       |
| Guardian-control C15/C16-C21            | `task-1788042241332-xafq11`                                                                                                                                                                                                                                                                               | [ADR-0036 — Guardian-control pure ABI](../adr/0036-guardian-control-pure-abi.md)                                                                                                                                                                                                             |
| Guardian-control C16 history            | `task-1788204847572-uh0olo`                                                                                                                                                                                                                                                                               | [ADR-0036 C16 private-store record](../adr/0036-guardian-control-pure-abi.md#c16-private-store-runtime-atomicity-record-2026-09-02)                                                                                                                                                          |
| Guardian-control C17 complete           | `task-1788204854834-82qx49`                                                                                                                                                                                                                                                                               | [ADR-0036 C17 acceptance record](../adr/0036-guardian-control-pure-abi.md#c17-acceptance-consolidation-record-2026-09-02)                                                                                                                                                                    |
| Guardian-control C18-C20 complete       | `task-1788204862237-jcs5sd` / `task-1788204868984-521i0d` / `task-1788204877088-j678ig`                                                                                                                                                                                                                   | [ADR-0036 independent-review record](../adr/0036-guardian-control-pure-abi.md#c18-c20-independent-review-record-2026-09-02)                                                                                                                                                                  |
| Guardian-control C21 closure            | `task-1788204883871-l9tsh9`                                                                                                                                                                                                                                                                               | [ADR-0036 C21 local closure record](../adr/0036-guardian-control-pure-abi.md#c21-local-documentation-and-umbrella-closure-record-2026-09-03)                                                                                                                                                 |
| Historical ADR-0037 evaluator-first DAG | `task-1788205371168-e6caq3` / `task-1788205386056-qz0anv` / `task-1788399091085-u7a5lw` / `task-1788205431734-trylt5` / `task-1788399095038-1zb8po` / `task-1788399098734-v8ve9g` / `task-1788399104822-pzsod1` / `task-1788399108388-65439n` / `task-1788399112386-qn8psc` / `task-1788399842562-kjszvk` | `task-plans/adr-0037-evaluator-first-dag-v2-2026-09-03`; historical 2026-09-03 planned/unstarted snapshot whose later rows were cancelled and superseded; no authority change                                                                                                                |
| ADR-0037 S7 V3 bounded local closure    | `task-1788573342748-wln111`                                                                                                                                                                                                                                                                               | Complete at `acd09b61`; Proposed, unregistered, and authority-null                                                                                                                                                                                                                           |
| ADR-0038 S3 V3 repository-input closure | `task-1788589313411-vm7pg0`                                                                                                                                                                                                                                                                               | S0-S3B implementation inputs are integrated through `37a02bb2`; documentation and independent review close only this bounded repository-input slice                                                                                                                                          |

Exact recall from the three research-memory entries succeeded. The remaining
rows are programme task maps for prerequisite and delivery gates; they are not
research-memory claims. Ruflo's higher-level
`ContextSynthesizer` reported unavailable, so it was not used as evidence. The
neural predictor had real embeddings but no stored patterns and returned no
prediction; it did not influence prioritization. The synthesis above is the
traceable intersection of recalled local findings and current first-party
sources.

The dated rows above preserve C16 history and record the current split: C17 and
all three independent reviews are complete; C21 and its programme umbrella are
complete for the local documentation/ledger boundary at commit `c01b3c6a`, and
their exact Ruflo rows were read back. At that historical checkpoint, ADR-0037
S0 and ADR-0041 S1 were dependency-eligible, pending, and unstarted. Current
replacement ADR-0037 S7 and ADR-0041 S1/S2 are complete. The GitHub-linked programme
Gist and main push were transferred to task `task-1788409495130-6ikk41`
because the selected N3 gitlink was not fetchable. That historical boundary's
`gistUpdated:false` and `pushed:false` remain exact. The dependency blocker is
now resolved by `75f538e0` and the unchanged commit is fetchable from
`sparkling/N3`; R1 owns current publication. This change does not change
ADR-0036's Proposed status or grant downstream runtime authority.

The Brain search verified the persistent swarm implementation in
`ruflo/v3/@claude-flow/cli/src/mcp-tools/swarm-tools.ts`; that source supports
the research ledger mechanics, not any claim about Oxigraph, Jena, or RDF4J.

## Historical pre-recovery QA score

The 2026-09-05 plan scored **98/100** against its programme rubric. This is
retained as historical advisory evidence and is not an R1 release gate or a
measure of delivered application value:

| Dimension                       | Score | Basis                                                                                                                                                |
| ------------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source authority and currency   | 20/20 | Exact local commits plus current official Jena/RDF4J pages                                                                                           |
| Implementation traceability     | 20/20 | Public API, tests, commits, and Ruflo memory keys named                                                                                              |
| Dependency and boundary clarity | 15/15 | DDD contexts and task prerequisites are explicit                                                                                                     |
| Architectural decision coverage | 10/10 | ADR-0019 is implemented; ADR-0020 has an implemented G2.1 slice but remains Proposed with ADR-0018 and ADR-0021 through ADR-0042 for their open work |
| Verifiable acceptance criteria  | 14/15 | Negative, crash, concurrency, security, and performance gates; no replacement adapter is selected, and any future candidate remains gated            |
| Risk and security coverage      | 10/10 | Commit ambiguity, replay, egress, index drift, and leakage covered                                                                                   |
| Scope discipline                |  9/10 | Core versus product choices separated; P3 decisions remain independently gated and unimplemented                                                     |

The two withheld points are real open state, not formatting debt: no replacement
adapter has been selected or admitted to the conformance kit, and the newly
admitted P3 decisions do not yet have product receipts. ADR-0016 is Implemented
for the public write seam and ADR-0019 is Implemented for egress, cancellation,
and runtime-derived service claims. ADR-0020's G2.1 registry is implemented,
while ADR-0018 and ADR-0020 through ADR-0041 remain Proposed for their
outstanding slices under this plan. ADR-0042 is Accepted and records the
RocksDB-retention boundary without implementing an alternative backend.
