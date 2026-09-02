# Oxigraph architecture decision records

These records define the semantic-parity programme. They distinguish a
version-pinned compatibility result, a bounded implementation profile, and
standards conformance. Test-suite results are evidence for the behavior they
exercise; they are not a substitute for a complete normative-requirement
mapping.

| Decision                                                                                                                             | Status      | Human-readable outcome                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ADR-0001 — Outcome-oriented Apache Jena parity](0001-outcome-oriented-jena-parity.md)                                               | Accepted    | Measure Jena compatibility as named observable outcomes, not Java API similarity                                                                   |
| [ADR-0002 — RDF-native Datalog engine](0002-rdf-native-datalog-engine.md)                                                            | Accepted    | Use a bounded D0–D2 rule engine as the shared inference substrate                                                                                  |
| [ADR-0003 — W3C 1.2 conformance baseline](0003-w3c-12-conformance-baseline.md)                                                       | Accepted    | Pin specifications, manifests, approval policy, and evidence                                                                                       |
| [ADR-0004 — MetaHarness and Darwin qualification](0004-metaharness-darwin-qualification.md)                                          | Accepted    | Let Darwin change policy only, behind immutable semantic oracles                                                                                   |
| [ADR-0005 — Agentic-QE integration](0005-agentic-qe-integration.md)                                                                  | Accepted    | Use Agentic-QE as a hardened coordinator, never as the Rust oracle                                                                                 |
| [ADR-0006 — W3C-first 1.2 parity](0006-w3c-first-12-parity.md)                                                                       | Accepted    | Treat Jena as a compatibility tranche and W3C as semantic authority                                                                                |
| [ADR-0007 — OWL 2 RL over Datalog](0007-owl-profiles-over-datalog.md)                                                                | Accepted    | Implement only bounded OWL 2 RL/RDF, not general OWL                                                                                               |
| [ADR-0008 — SHACL processor profiles](0008-shacl-processor-profiles.md)                                                              | Accepted    | Expose dated Core, Node Expressions, SPARQL, Rules, and Compact Syntax feature sets                                                                |
| [ADR-0009 — Snapshot reasoning and explicit materialization](0009-snapshot-reasoning-materialization.md)                             | Accepted    | Keep inference read-only by default and fail closed for D2 replay                                                                                  |
| [ADR-0010 — Bounded RDF Dataset Canonicalization 1.0](0010-bounded-rdf-dataset-canonicalization.md)                                  | Accepted    | Make canonicalization fallible, atomic, work-bounded, and exactly W3C-tested                                                                       |
| [ADR-0011 — SPARQL VERSION and protocol semantics](0011-sparql-version-and-protocol-semantics.md)                                    | Accepted    | Make in-band version declarations authoritative without overstating protocol support                                                               |
| [ADR-0012 — Immutable broad Jena differential harness](0012-immutable-broad-jena-harness.md)                                         | Accepted    | Lock and receipt an exact classified Jena outcome inventory                                                                                        |
| [ADR-0013 — Mutation competence and provenance policy](0013-mutation-competence-and-provenance.md)                                   | Accepted    | Require source-bound native outcomes with no viable survivors or equivalent-mutant waivers                                                         |
| [ADR-0014 — End-to-end RDF dataset graph topology](0014-rdf-dataset-graph-topology.md)                                               | Accepted    | Preserve empty named-graph presence across models, I/O, stores, protocols, reasoning, and bindings                                                 |
| [ADR-0015 — Parallel bulk-load failure semantics](0015-parallel-bulk-load-failure-semantics.md)                                      | Accepted    | Aggregate every worker failure, return nonzero, and make the per-file versus cross-file atomicity boundary explicit                                |
| [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md)                                  | Implemented | Let replacement persistence planes execute request-atomic SPARQL Update without private storage types                                              |
| [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md)        | Implemented | Keep engineering work separate from semantic qualification, rebuild patched candidates before focused evaluation, and retain human-only promotion  |
| [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md)                            | Proposed    | Negotiate dimensioned guarantees and prove a serialized-writer RocksDB baseline before stronger isolation claims                                   |
| [ADR-0019 — Unified egress, cancellation, and service claims](0019-unified-egress-cancellation-and-service-claims.md)                | Implemented | Give remote loading and SERVICE one policy/cancellation boundary and derive claims from effective evaluator capabilities                           |
| [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md)      | Proposed    | G2.1 transactionally commits namespaces; normalized effects, durable receipts, and the ordered outbox remain planned                               |
| [ADR-0021 — Transaction-time SHACL validation](0021-transaction-time-shacl-validation.md)                                            | Proposed    | Validate the complete resulting staged view under the same isolation gate as commit                                                                |
| [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md)                          | Proposed    | Separate liveness from readiness and prove receipt-bound backup through fresh-directory restore                                                    |
| [ADR-0023 — Statistics and bounded join planning](0023-statistics-and-bounded-join-planning.md)                                      | Proposed    | Add optional snapshot-scoped statistics, bounded join search, and a correctness-neutral fallback                                                   |
| [ADR-0024 — Rebuildable derived indexes](0024-rebuildable-derived-indexes.md)                                                        | Proposed    | Share one crash-safe rebuild/activation lifecycle, then keep text and spatial providers optional with explicit strict/eventual freshness contracts |
| [ADR-0025 — Explicit SERVICE federation](0025-explicit-service-federation.md)                                                        | Proposed    | Optimize only explicit SERVICE clauses within endpoint, egress, resource, and SILENT-semantics bounds                                              |
| [ADR-0026 — Service identity and authorization boundary](0026-service-identity-and-authorization.md)                                 | Proposed    | Authenticate and authorize server operations before parsing, storage, or egress without coupling identity to the embedded store                    |
| [ADR-0027 — Workload admission and operator resources](0027-workload-admission-and-operator-resources.md)                            | Proposed    | Carry one bounded admission, deadline, cancellation, and resource contract through each server request                                             |
| [ADR-0028 — Safe storage schema upgrades](0028-safe-storage-schema-upgrades.md)                                                      | Proposed    | Replace mutation-on-open with inspected, source-preserving, receipted shadow upgrades and explicit cutover                                         |
| [ADR-0029 — RDF4J REST interoperability](0029-rdf4j-rest-interoperability.md)                                                        | Proposed    | Offer an optional versioned single-repository RDF4J wire facade backed by native capabilities                                                      |
| [ADR-0030 — Leased remote HTTP transactions](0030-leased-remote-http-transactions.md)                                                | Proposed    | Bound server-owned transactions with opaque leases, explicit renewal, cleanup, and durable outcome lookup                                          |
| [ADR-0031 — Multi-repository lifecycle](0031-multi-repository-lifecycle.md)                                                          | Proposed    | Manage repositories through an authorized, journaled, resource-isolated, recoverable lifecycle                                                     |
| [ADR-0032 — Incremental entailment projections](0032-incremental-entailment-projections.md)                                          | Proposed    | Maintain optional rebuildable inferred views while keeping primary RDF authoritative and differential proof continuous                             |
| [ADR-0033 — Analytical/WCOJ execution](0033-analytical-wcoj-execution.md)                                                            | Proposed    | Research a bounded opt-in analytical join operator without replacing ordinary SPARQL planning or semantics                                         |
| [ADR-0034 — First-class exact new-file admission](0034-first-class-exact-new-file-admission.md)                                      | Proposed    | Own exact schema-v2 admission, receipt-v7, dormant dispatch/profile literals, and the early fail-closed qualification gate                         |
| [ADR-0035 — Durable native containment guardian and crash recovery](0035-durable-native-containment-guardian-and-recovery.md)        | Proposed    | Keep a stable native reaper, persist intent before effects, and recover delegated cgroups without inventing reap or commit authority               |
| [ADR-0036 — Guardian-control pure ABI](0036-guardian-control-pure-abi.md)                                                            | Proposed    | Freeze exact normal and recovery guardian transport without granting physical authority                                                            |
| [ADR-0037 — Durable containment statefs and manager protocol](0037-durable-containment-statefs-and-manager-protocol.md)              | Proposed    | Own the sole statefs policy/oracle, held-root protocol, and separately attested bounded statefs-syscalls object                                    |
| [ADR-0038 — Native containment manager, guardian, and launch trampoline](0038-native-containment-manager-guardian-and-trampoline.md) | Proposed    | Link ADR-0037's object unchanged and own only unregistered process/cgroup/exec mechanics, executables, adapter, and race-free launch               |
| [ADR-0039 — Delegated-host containment qualification and readiness](0039-delegated-host-containment-qualification-and-readiness.md)  | Proposed    | Consume ADR-0034's frozen bytes and own current-host qualification, activation binding, and path-executed runtime closure only                     |

The index contains 39 decisions. ADR-0018 and ADR-0020 through ADR-0039 are
living implementation decisions for
outstanding work. Their Proposed status is deliberate: the corresponding
programme tasks and promotion evidence are not implemented merely because the
architecture is recorded. ADR-0019 has closed its bounded G1.5-G1.6 profile,
and ADR-0020 has closed only G2.1; it remains Proposed until G2.2-G2.3c are
implemented. ADR-0034 separately gates the exact schema-v2 new-file
pre-registration required before G2.2 may add a semantic-change module. The
repository ADR dry-run parses 221 unique
graph edges: 46 `depends-on`, 171 `related`, and 4 `amends`, with no duplicate,
dangling, or self edge and no directed dependency or supersession cycle.
Ownership is likewise one-way: ADR-0037 owns the statefs policy and exact
statefs-syscalls object, which ADR-0038 links unchanged; ADR-0034 owns dormant
receipt-v7/schema-v2 pre-registration and the early qualification gate, whose
frozen bytes ADR-0039 consumes while owning only current-host qualification,
activation binding, and path-executed runtime closure. Readiness remains
exactly `{status: "unavailable", reason: "native-adapter-unavailable"}`. Even
after those gates close, the cancel-only protocol leaves G2.2 blocked pending a
separately ratified commit-capable successor. Commit
`54a056e0` closes the reviewed, unregistered native-worker slice after 112/112
focused controls, and `11e72201` adds the opaque structural verifier lifecycle
with a 128/128 related non-G1.7 matrix. Commit `f3a0c127` adds the narrow
eight-file retained-FD payload binding; the expanded matrix passes 177/177 and
commit `c2cdde16` adds the dormant, non-authoritative cgroup-v2/pidfd lifecycle
contract. Commit `23997c29` adds its strict canonical request/status replay and
compile-only static supervisor attestation without implementing or executing
native mechanics. Commit `88b9d7e7` adds the separate successor FD-map v2,
exact launch capsule, and authority-null interactive control reducer without
registering or executing them. The expanded related matrix passes 237/237 on
both current Node and Node 20, three independent reviews are GO for the dormant
scope. Commit `7191ddde` adds the next unregistered launch/bootstrap successor:
exact FDs 18-25, positive held-stop exec proof, an in-band capsule, and a
cancel-only pre-clone terminal path. Retained-file evidence is honestly limited
to FDs 4-17, and all live control-descriptor, writer, cleanup, physical, and
authority facts remain future requirements or null/false. The focused tests
pass 11/11 and the expanded matrix passes 248/248 on current Node and Node 20;
three fresh reviews are GO for that dormant boundary. Commit `ab668ddd` adds
ADR-0035's separate unregistered pure guardian-journal contract with exact
cancel-only state, canonical semantic/raw hashes, replay anchors and bindings,
null physical facts, and all-false authority. Its focused suite passes 14/14,
the expanded related non-G1.7 matrix passes 262/262 on current Node and Node 20,
the clean committed-code identity control passes 2/2 on both, and three
independent reviews are GO for that bounded pure scope. Commit `040f3343`
adds the separate test-local Linux x86-64 preflight execution copy, held
executable identity, exact FD0-19/FD0-17 observations, three-frame terminal
transcript, and thirty returned fail-closed scenarios. Its focused suite
passes 47/47 and the top-level non-G1.7 suite, excluding the separate
committed-clean identity control, passes 495/495 on current Node and Node 20;
the identity control passes 2/2 on both after commit, and two fresh reviews
are GO. ADR-0035 task `task-1788002473147-nsat6x` is 75% in progress for this
checkpoint; the broader exact-admission task is now 97% after the exact early
gate, frozen evaluator/reference chain, and separate dormant-v2 registration.
Filesystem-backed guardian/reaper durability and recovery, delegated-cgroup
evidence, pidfd/waitid and race-free exec binding, the physical native adapter
and full runtime-closure proof, ADR-0034's application receipt v7/replay and
dormant command/CLI/package dispatch, ADR-0039's qualification/activation gate,
a later commit-capable successor, and G2.2 remain open. ADR-0035 separates
those native concerns from ADR-0034's broader admission gate. ADR-0036 through
ADR-0039 decompose the remaining control ABI, statefs/manager, native
executable, and delegated-host readiness work without changing the current
unavailable boundary. ADR-0036's integrated B3-B6 evaluator checkpoints now
freeze 197/330 semantic negatives, plus 69 foundation negatives and 11
positives: 277 controls in total. Commits `99649146` and `05bbd8bb` close the
`untrustedSinks`, `rawEscapes`, and `literalMisuse` buckets; commit `61122498`
closes `scopeJoins` and `nestedRecursion`; and commit `2f9e51ed` raises
`commitMutations` to 67/200, leaving 133 semantic negatives. The candidate
source remains absent, readiness remains exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`, and this
evidence does not change ADR-0036's Proposed status. Twenty-one decisions in
this range remain Proposed.

The preceding ADR-0036 paragraph is the preserved historical C14 checkpoint.
The dated 2026-09-02 C15 checkpoint is GREEN at helper commit `41dd2508`,
guardian/fixture commit `23d37556`, and evaluator commit `4620dd92`. The live
v1 fixture path now carries raw SHA-256
`4f4433ed7e74a6076154d19139ffe79f8cf4a8fab4dbf0f5808a36fddf46dbdd`
and canonical-JSON SHA-256
`7348640cbf1128447cea9af280e4c5eec4fbcdb5405055fa883a0c81cb462fe8`;
historical C14 is preserved only by evaluator-private reconstruction. Current
Node 24.14.1, exact Node 20.0.0, and Node 20.20.2 each pass direct 11/11 and main
17 pass / zero fail / two TODO. Independent review returned APPROVE. C16
private-store and C17 final aggregate are those two TODOs; C18-C21 remain
pending. ADR-0036 stays Proposed, readiness stays exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`, and the slice
adds no dependency, runtime registration, production authority, qualification,
promotion, or publication permission.

The preceding paragraph remains the dated C15 record. The 2026-09-02 C16
private-store checkpoint is GREEN from RED `5f717090` to integrated commit
`930a7722`; only the main and adversarial evaluators changed. The frozen receipt
identity is
`914baa75ad37e662895caf2002f98f395c47586bd8681d746ecd97820c7a18aa`,
covering three stores, ten owners, five phases, and 50 unique controls. The
registration inventory remains three entries but now has zero registration
TODOs at identity
`b91336686a76ed8b28d2b68dbc4f6739d60486a1ea03d30797d6980bcb5c04c9`.
Node 24.14.1, exact Node 20.0.0, and Node 20.20.2 each pass direct 11/11 and
report main 19 total / 18 pass / zero fail / one TODO and combined 30 total /
29 pass / zero fail / one TODO. Independent review returned APPROVE with no
findings. C17 final aggregate is the sole evaluator TODO; C18-C21 remain
pending. At the pre-documentation freeze, C16 task
`task-1788204847572-uh0olo` was recorded `in_progress` at 95%; its ledger
closure is a post-integration action, not evidence conferred by this index.
ADR-0036 remains Proposed, readiness remains exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`, and C16 grants
no source, helper, fixture, package, lockfile, dependency, production, runtime,
filesystem, process, cgroup, G1.7, G2.2, qualification, promotion, publication,
push, or product authority.

The preceding paragraph is the dated C16 record. C17 is GREEN from evaluator
RED `0bafc84d` to integrated commit `b037ed0a`, tree `64cb90bc`. Its stable
receipt
`eb548452b2f59a139730d11c0eb7046a2f0f4ab9c445e895ca5a7865382fb377`
binds 319 monitored calls, all 318 receipt mutations, all 25 behavioral
classes, and zero survivors. Node 24.14.1, exact Node 20.0.0, and Node 20.20.2
each pass focused 20/20, direct 11/11, main 19/19, and combined 30/30 with zero
TODOs. Independent C18 contract, C19 compatibility, and C20 security/mutation
reviews each returned APPROVE with zero blocking findings; their exact receipts
were stored and read back before task closure. C21 reconciles this bounded
engineering evidence without accepting the decision. ADR-0036 remains
Proposed, readiness remains exactly
`{status: "unavailable", reason: "native-adapter-unavailable"}`, and no runtime,
physical, product, G1.7, G2.2, qualification, promotion, publication, or push
authority is added.

ADR-0017's post-G1.6 canonical-registry and candidate-rejection evidence
controls are implemented in commits `4a15caa0` and `afe30c7d`; the current
G1.4b-aware registry has nine tasks and 33 commands. These remain local-only
engineering controls and grant no semantic-qualification or promotion
authority. G1.7 contract v7 and its fail-closed runner/verifier gates are
implemented through `d1e18c6e`: the control authorization and final decision
remain proposed/unapproved, `run` exits before work, and the approved-fixture
path has no production execution owner. V7 preserves v6's exact
authorization-bound sample framing, paired negative/A/A statistics, noise
boundaries, and verdict precedence while binding exact merged product
`e9d2db1b`; v1/v3/v4/v5/v6 contracts remain structural replay-only. Pure
commits `d3af2e17` and `45121da9` replay four isolated builds, two serialized
sessions, 392 exact launches, recomputed Darwin statistics, and a bounded
canonical control-receipt candidate. The replay is intentionally
`CANDIDATE_REPLAYED`, with no final binding or execution authority; it is not
current production owner emission. Commit `fbbb692b` separately implements the
exact write-once, receipt-last physical envelope and current-state replay. Seal
returns no binding; only replayed PASS can yield a prospective binding, and all
authority remains false. The physical result explicitly does not claim crash,
power-loss, filesystem-flush durability, replay proof of historical
receipt-last order, or same-UID tamper resistance.
Commit `f04b9bc7` adds the dormant authority-free containment owner while
rejecting the current proposed authorization before mechanics. Commit
`a457f46c` adds the exact four-build plan and descriptor-anchored source
workspace with global pre-write Git-object admission and unreaped-handle
retention. Commit `c5687dac` adds pure build-process/four-product capture replay
with exact held source/tool/output ancestry, raw streams, executable bytes, and
ELF identity. Production build begin/finish, native containment mechanics, and
live build/control/sample owners remain unavailable. The source projection is
authority-free; the containment/build/product replay projections are also
binding-null and final-decision-ineligible. Commits `13afa94d` and `3f8951e3`
freeze and harden canonical execution-request v1 bytes; because those bytes
bind isolation policy v1, they are permanently launch-ineligible. Commit
`8b2c6366` adds exact-linked, replay-only process-evidence v3 over that request,
containment, raw Cargo JSONL, cgroup terminal observations, and the held target
ELF. It remains `SUCCESSOR_PRIVATE_ISSUER_REQUIRED`, with `binding: false` and
no authority; request v1 and process v3 are legacy-incompatible with the
successor path. Policy v2 (`ef869cf4`, corrected in `466d2d78`) and execution
request v2 (`75a076938ac6c4ecc72c295f56d09e5c0f8e8787`) now freeze a
structurally compatible policy/request graph. Request v2 remains
`POLICY_V2_BOUND_PRIVATE_ISSUER_REQUIRED` and `STRUCTURAL_POLICY_ONLY`, with
`physicalLaunchEligible: false`, `binding: null`, and every authority flag
false. Commit `c113a88f321ade44e7d913f5da87a8184ea56148` adds an exact-attested
dormant native `execveat` helper and bounded status protocol. Its tests compile
but never execute the helper; it remains `DORMANT_ATTESTATION_ONLY`, lacks an
exact runtime request/argv/environment binding, and grants no physical issuer
or live authority. The private co-located issuer, native containment-v2
adapter, production control/sample/qualification owners, and live evidence
remain open.

G1.4a product commit `2f518e04` and its frozen 7/9/20/3/2 acceptance close the
built-in Store outcome slice. G1.4b product commit `590a3229` and receipt
`d4a54f90...` close only the evaluator-separated simulated storage-call and
malformed-ledger slice after exact replay and 8/8, 7/7, and 20/20 controls;
crash, power-loss, and fsync durability remain explicit non-claims. That
receipt is exact-bound as a prerequisite but is not a G1.7 control receipt. A
two-phase human control authorization and physically sealed negative/A/A
receipt must precede the final reference/performance/noise decision and subject
benchmark. No current production G1.7 samples, physically sealed control or
qualification receipt, live benchmark result, qualification, or promotion
exists, so G1.7 and ADR-0018 remain open.

G2.1 product commit `be08cf3bbcb836ec46df2b864d31e80f5b837b52`
implements the additive transactional namespace registry for memory, RocksDB,
and the rewritten persistence plane. Its default-feature evaluator passes 13/13
across all three planes; its no-default evaluator passes 8/8 across memory and
the rewritten plane. Focused regressions pass
`store` 26/26, `transaction_outcomes` 7/7, `transaction_state_model` 3/3, and
`transactional_dataset` 3/3. ADR-0020 remains Proposed because normalized
effects, durable receipts/outcome resolution, the authoritative outbox, and its
retention/governance slices G2.2-G2.3c are not implemented.

ADR-0034 commits `78b2cf99` through `65fb0e7a` preserve schema-v1 bytes while
adding exact v2 paths, trees, contracts, reconstruction, context, schema,
assembly, and worker-output controls. Commit `54a056e0` adds exact stdin,
retained-descriptor provider/schema/Git verification, original-process-group
quiescence, and unsafe-root retention. Commit `11e72201` adds the opaque
candidate/verifier lifecycle but keeps the structural closure evidence
explicitly unproved and production unavailable. Commit `fd9e4d05` adds the
first-action unavailable qualification gate; `c9cb6423`, `997ad287`, and
`dfd6d92d` freeze the exact baseline/evaluator/reference chain; and `f9ab7c72`
adds the separate dormant-v2 profile, raw contract, production worker context,
and reference reconstruction. The active v1 registry remains nine tasks and
33 commands. Focused matrices pass 87/87 on Node 24 and 55/55 on Node 20.0.0
and 20.20.2; the top-level non-G1.7 suite passes 694/694 on Node 24 and Node
20.20.2. Independent audits returned GO only for the Proposed, dormant
authority-null infrastructure and NO-GO for activation. It grants no product,
qualification, or promotion authority and cannot admit G2.2's new module.

Audited two-parent merge `e9d2db1b` records upstream `ec68e3dd` as an ancestor
while preserving ADR-0014's selected-missing Graph Store `POST=404` contract,
strict XML validation, and fork QA lanes. Its exact-tree Rust, Python,
workflow, and 409/0/2 engineering-harness evidence passes. Commit `d1e18c6e`
reseals its subject/tree/`Cargo.lock` and evaluator composition as current v7.
After G2.1, the full harness suite reports 667 total: 663 pass, one deliberate
sealed-subject freshness gate fails after detecting the newly committed G2.1
product paths, and three host-gated tests skip. This is neither a helper/request
regression nor green current-HEAD qualification. The later authority-free G1.7
mechanics now include replay-only build owner v2 (`3688ccda`), the frozen exact
non-tmpfs mount-namespace mapping policy (`da41d7e0`), bounded destructive
cleanup (`3b289522`), the POSIX raw-byte process supervisor (`c5050e9c`),
legacy-incompatible execution-request v1 (`13afa94d`/`3f8951e3`) and replay-only
process-evidence v3 (`8b2c6366`), policy/request v2 (`ef869cf4`/`466d2d78` and
`75a07693`), and the compile-only dormant helper attestation (`c113a88f`).
Neither that pure identity nor
the physical archive capability creates a live control, benchmark,
qualification, promotion, publication, or push authority.
Ruflo map `task-plans/linked-data-store-g0-g4-2026-08-28-v15` preserves the 42
stable product tasks and its historical corrected-G1.7 checkpoint at 60%.
The current G1.7 row is 74%. Pure candidate task
`task-1787892615000-rdwz7q` is complete in `45121da9`; physical-envelope task
`task-1787896401667-xookiy` is complete in `fbbb692b`. Workspace/build-owner
task `task-1787902127894-7n7vk3` remains in progress at 93%, and containment
task `task-1787902138074-0w648x` remains in progress at 92%.

The authoritative claim and freshness state is
[the machine-readable conformance ledger](../research/conformance-ledger.json);
its entries distinguish historical sealed-subject evidence from current-HEAD
qualification.
Its W3C document and grouped-obligation mapping is
[the normative requirements inventory](../research/normative-requirements.json).
Source authority and revision metadata live in
[the standards registry](../research/standards-registry.json). The
[implementation and qualification plan](../plans/semantic-parity-metaharness-plan.md)
shows which closure gates remain open.

ADR statuses and current-evidence qualifiers in this index were reviewed on
2026-08-29. Individual sealed results retain their original evidence dates.
G0.1-G0.7 retain historical source-bound completion evidence: registered
sources, the locked Jena runner, two byte-identical runs of the refreshed
76/198 profile, the 144/129 Agentic-QE inventories, the then-34-test
`persistence-write` profile (now 45 tests in source), the generic OxDatalog mutation run
`731e6467-2cab-4260-8d15-b34e4ebc8ed6`, and the prior protected-claims
reconciliation. At tracked-clean subject `5a93890f`, schema-v5 adapter,
`persistence-write`, and G1 regression runs pass 40/40, 45/45, and 66/66 and
were independently reopened. The broad dirty flag reflects only protected
untracked Ruflo/runtime paths. This is current scoped evidence, not an
aggregate Agentic receipt. G1.6
has bounded source-bound acceptance from the seven-stage
4/17/1/1/12 verifier split and three rejecting product controls. That closes
ADR-0019 but does not grant current-HEAD umbrella qualification, which remains
withheld. Full MetaHarness semantic qualification and independent verification
have not yet been regenerated, and ADR-0018/G1.7
compatibility/performance promotion remains open.
Working Draft and editor-draft material is never described as a W3C
Recommendation.
