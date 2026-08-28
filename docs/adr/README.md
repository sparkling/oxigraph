# Oxigraph architecture decision records

These records define the semantic-parity programme. They distinguish a
version-pinned compatibility result, a bounded implementation profile, and
standards conformance. Test-suite results are evidence for the behavior they
exercise; they are not a substitute for a complete normative-requirement
mapping.

| Decision                                                                                                                        | Status      | Human-readable outcome                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ADR-0001 — Outcome-oriented Apache Jena parity](0001-outcome-oriented-jena-parity.md)                                          | Accepted    | Measure Jena compatibility as named observable outcomes, not Java API similarity                                                                   |
| [ADR-0002 — RDF-native Datalog engine](0002-rdf-native-datalog-engine.md)                                                       | Accepted    | Use a bounded D0–D2 rule engine as the shared inference substrate                                                                                  |
| [ADR-0003 — W3C 1.2 conformance baseline](0003-w3c-12-conformance-baseline.md)                                                  | Accepted    | Pin specifications, manifests, approval policy, and evidence                                                                                       |
| [ADR-0004 — MetaHarness and Darwin qualification](0004-metaharness-darwin-qualification.md)                                     | Accepted    | Let Darwin change policy only, behind immutable semantic oracles                                                                                   |
| [ADR-0005 — Agentic-QE integration](0005-agentic-qe-integration.md)                                                             | Accepted    | Use Agentic-QE as a hardened coordinator, never as the Rust oracle                                                                                 |
| [ADR-0006 — W3C-first 1.2 parity](0006-w3c-first-12-parity.md)                                                                  | Accepted    | Treat Jena as a compatibility tranche and W3C as semantic authority                                                                                |
| [ADR-0007 — OWL 2 RL over Datalog](0007-owl-profiles-over-datalog.md)                                                           | Accepted    | Implement only bounded OWL 2 RL/RDF, not general OWL                                                                                               |
| [ADR-0008 — SHACL processor profiles](0008-shacl-processor-profiles.md)                                                         | Accepted    | Expose dated Core, Node Expressions, SPARQL, Rules, and Compact Syntax feature sets                                                                |
| [ADR-0009 — Snapshot reasoning and explicit materialization](0009-snapshot-reasoning-materialization.md)                        | Accepted    | Keep inference read-only by default and fail closed for D2 replay                                                                                  |
| [ADR-0010 — Bounded RDF Dataset Canonicalization 1.0](0010-bounded-rdf-dataset-canonicalization.md)                             | Accepted    | Make canonicalization fallible, atomic, work-bounded, and exactly W3C-tested                                                                       |
| [ADR-0011 — SPARQL VERSION and protocol semantics](0011-sparql-version-and-protocol-semantics.md)                               | Accepted    | Make in-band version declarations authoritative without overstating protocol support                                                               |
| [ADR-0012 — Immutable broad Jena differential harness](0012-immutable-broad-jena-harness.md)                                    | Accepted    | Lock and receipt an exact classified Jena outcome inventory                                                                                        |
| [ADR-0013 — Mutation competence and provenance policy](0013-mutation-competence-and-provenance.md)                              | Accepted    | Require source-bound native outcomes with no viable survivors or equivalent-mutant waivers                                                         |
| [ADR-0014 — End-to-end RDF dataset graph topology](0014-rdf-dataset-graph-topology.md)                                          | Accepted    | Preserve empty named-graph presence across models, I/O, stores, protocols, reasoning, and bindings                                                 |
| [ADR-0015 — Parallel bulk-load failure semantics](0015-parallel-bulk-load-failure-semantics.md)                                 | Accepted    | Aggregate every worker failure, return nonzero, and make the per-file versus cross-file atomicity boundary explicit                                |
| [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md)                             | Implemented | Let replacement persistence planes execute request-atomic SPARQL Update without private storage types                                              |
| [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md)   | Implemented | Keep engineering work separate from semantic qualification, rebuild patched candidates before focused evaluation, and retain human-only promotion  |
| [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md)                       | Proposed    | Negotiate dimensioned guarantees and prove a serialized-writer RocksDB baseline before stronger isolation claims                                   |
| [ADR-0019 — Unified egress, cancellation, and service claims](0019-unified-egress-cancellation-and-service-claims.md)           | Implemented | Give remote loading and SERVICE one policy/cancellation boundary and derive claims from effective evaluator capabilities                           |
| [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md) | Proposed    | Commit namespaces, semantic effects, durable outcome receipts, and an ordered outbox atomically                                                    |
| [ADR-0021 — Transaction-time SHACL validation](0021-transaction-time-shacl-validation.md)                                       | Proposed    | Validate the complete resulting staged view under the same isolation gate as commit                                                                |
| [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md)                     | Proposed    | Separate liveness from readiness and prove receipt-bound backup through fresh-directory restore                                                    |
| [ADR-0023 — Statistics and bounded join planning](0023-statistics-and-bounded-join-planning.md)                                 | Proposed    | Add optional snapshot-scoped statistics, bounded join search, and a correctness-neutral fallback                                                   |
| [ADR-0024 — Rebuildable derived indexes](0024-rebuildable-derived-indexes.md)                                                   | Proposed    | Share one crash-safe rebuild/activation lifecycle, then keep text and spatial providers optional with explicit strict/eventual freshness contracts |
| [ADR-0025 — Explicit SERVICE federation](0025-explicit-service-federation.md)                                                   | Proposed    | Optimize only explicit SERVICE clauses within endpoint, egress, resource, and SILENT-semantics bounds                                              |
| [ADR-0026 — Service identity and authorization boundary](0026-service-identity-and-authorization.md)                            | Proposed    | Authenticate and authorize server operations before parsing, storage, or egress without coupling identity to the embedded store                    |
| [ADR-0027 — Workload admission and operator resources](0027-workload-admission-and-operator-resources.md)                       | Proposed    | Carry one bounded admission, deadline, cancellation, and resource contract through each server request                                             |
| [ADR-0028 — Safe storage schema upgrades](0028-safe-storage-schema-upgrades.md)                                                 | Proposed    | Replace mutation-on-open with inspected, source-preserving, receipted shadow upgrades and explicit cutover                                         |
| [ADR-0029 — RDF4J REST interoperability](0029-rdf4j-rest-interoperability.md)                                                   | Proposed    | Offer an optional versioned single-repository RDF4J wire facade backed by native capabilities                                                      |
| [ADR-0030 — Leased remote HTTP transactions](0030-leased-remote-http-transactions.md)                                           | Proposed    | Bound server-owned transactions with opaque leases, explicit renewal, cleanup, and durable outcome lookup                                          |
| [ADR-0031 — Multi-repository lifecycle](0031-multi-repository-lifecycle.md)                                                     | Proposed    | Manage repositories through an authorized, journaled, resource-isolated, recoverable lifecycle                                                     |
| [ADR-0032 — Incremental entailment projections](0032-incremental-entailment-projections.md)                                     | Proposed    | Maintain optional rebuildable inferred views while keeping primary RDF authoritative and differential proof continuous                             |
| [ADR-0033 — Analytical/WCOJ execution](0033-analytical-wcoj-execution.md)                                                       | Proposed    | Research a bounded opt-in analytical join operator without replacing ordinary SPARQL planning or semantics                                         |

ADR-0018 and ADR-0020 through ADR-0033 are living implementation decisions for
outstanding work. Their Proposed status is deliberate: the corresponding
G1-G4 tasks and promotion evidence are not implemented merely because the
architecture is recorded. ADR-0019 alone has closed its bounded G1.5-G1.6
implementation profile; fifteen decisions in this range remain Proposed.
ADR-0017's post-G1.6 canonical-registry and candidate-rejection evidence
controls are implemented in commits `4a15caa0` and `afe30c7d`; the current
G1.4b-aware registry has nine tasks and 33 commands. These remain local-only
engineering controls and grant no semantic-qualification or promotion
authority. G1.7 contract v6 and its fail-closed runner/verifier gates are
implemented through `799307fb`: the control authorization and final decision
remain proposed/unapproved, `run` exits before work, and the approved-fixture
path has no production execution owner. V6 freezes exact authorization-bound
sample framing, paired negative/A/A statistics, noise boundaries, and verdict
precedence; pure fixture replay is not current owner emission, and v1/v3/v4/v5
contracts remain structural replay-only.

G1.4a product commit `2f518e04` and its frozen 7/9/20/3/2 acceptance close the
built-in Store outcome slice. G1.4b product commit `590a3229` and receipt
`d4a54f90...` close only the evaluator-separated simulated storage-call and
malformed-ledger slice after exact replay and 8/8, 7/7, and 20/20 controls;
crash, power-loss, and fsync durability remain explicit non-claims. That
receipt is exact-bound as a prerequisite but is not a G1.7 control receipt. A
two-phase human control authorization and
sealed negative/A/A receipt must precede the final reference/performance/noise
decision and subject benchmark. No current receipt, samples, benchmark result,
qualification, or promotion exists, so G1.7 and ADR-0018 remain open.

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
2026-08-28. Individual sealed results retain their original evidence dates.
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
