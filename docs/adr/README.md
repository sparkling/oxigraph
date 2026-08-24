# Oxigraph architecture decision records

These records define the semantic-parity programme. They distinguish a
version-pinned compatibility result, a bounded implementation profile, and
standards conformance. Test-suite results are evidence for the behavior they
exercise; they are not a substitute for a complete normative-requirement
mapping.

| Decision | Status | Human-readable outcome |
|---|---|---|
| [ADR-0001 — Outcome-oriented Apache Jena parity](0001-outcome-oriented-jena-parity.md) | Accepted | Measure Jena compatibility as named observable outcomes, not Java API similarity |
| [ADR-0002 — RDF-native Datalog engine](0002-rdf-native-datalog-engine.md) | Accepted | Use a bounded D0–D2 rule engine as the shared inference substrate |
| [ADR-0003 — W3C 1.2 conformance baseline](0003-w3c-12-conformance-baseline.md) | Accepted | Pin specifications, manifests, approval policy, and evidence |
| [ADR-0004 — MetaHarness and Darwin qualification](0004-metaharness-darwin-qualification.md) | Accepted | Let Darwin change policy only, behind immutable semantic oracles |
| [ADR-0005 — Agentic-QE integration](0005-agentic-qe-integration.md) | Accepted | Use Agentic-QE as a hardened coordinator, never as the Rust oracle |
| [ADR-0006 — W3C-first 1.2 parity](0006-w3c-first-12-parity.md) | Accepted | Treat Jena as a compatibility tranche and W3C as semantic authority |
| [ADR-0007 — OWL 2 RL over Datalog](0007-owl-profiles-over-datalog.md) | Accepted | Implement only bounded OWL 2 RL/RDF, not general OWL |
| [ADR-0008 — SHACL processor profiles](0008-shacl-processor-profiles.md) | Accepted | Expose dated Core, Node Expressions, SPARQL, Rules, and Compact Syntax feature sets |
| [ADR-0009 — Snapshot reasoning and explicit materialization](0009-snapshot-reasoning-materialization.md) | Accepted | Keep inference read-only by default and fail closed for D2 replay |
| [ADR-0010 — Bounded RDF Dataset Canonicalization 1.0](0010-bounded-rdf-dataset-canonicalization.md) | Accepted | Make canonicalization fallible, atomic, work-bounded, and exactly W3C-tested |
| [ADR-0011 — SPARQL VERSION and protocol semantics](0011-sparql-version-and-protocol-semantics.md) | Accepted | Make in-band version declarations authoritative without overstating protocol support |
| [ADR-0012 — Immutable broad Jena differential harness](0012-immutable-broad-jena-harness.md) | Accepted | Lock and receipt an exact classified Jena outcome inventory |
| [ADR-0013 — Mutation competence and provenance policy](0013-mutation-competence-and-provenance.md) | Accepted | Require source-bound native outcomes with no viable survivors or equivalent-mutant waivers |
| [ADR-0014 — End-to-end RDF dataset graph topology](0014-rdf-dataset-graph-topology.md) | Accepted | Preserve empty named-graph presence across models, I/O, stores, protocols, reasoning, and bindings |
| [ADR-0015 — Parallel bulk-load failure semantics](0015-parallel-bulk-load-failure-semantics.md) | Accepted | Aggregate every worker failure, return nonzero, and make the per-file versus cross-file atomicity boundary explicit |
| [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md) | Implemented | Let replacement persistence planes execute request-atomic SPARQL Update without private storage types |
| [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md) | Accepted | Keep engineering work separate from semantic qualification, rebuild patched candidates before focused evaluation, and retain human-only promotion |
| [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md) | Proposed | Negotiate dimensioned guarantees and prove a serialized-writer RocksDB baseline before stronger isolation claims |
| [ADR-0019 — Unified egress, cancellation, and service claims](0019-unified-egress-cancellation-and-service-claims.md) | Proposed | Give remote loading and SERVICE one policy/cancellation boundary and derive claims from runtime receipts |
| [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md) | Proposed | Commit namespaces, semantic effects, durable outcome receipts, and an ordered outbox atomically |
| [ADR-0021 — Transaction-time SHACL validation](0021-transaction-time-shacl-validation.md) | Proposed | Validate the complete resulting staged view under the same isolation gate as commit |
| [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md) | Proposed | Separate liveness from readiness and prove receipt-bound backup through fresh-directory restore |
| [ADR-0023 — Statistics and bounded join planning](0023-statistics-and-bounded-join-planning.md) | Proposed | Add optional snapshot-scoped statistics, bounded join search, and a correctness-neutral fallback |
| [ADR-0024 — Rebuildable derived indexes](0024-rebuildable-derived-indexes.md) | Proposed | Keep text and spatial indexes rebuildable with explicit strict/eventual freshness contracts |
| [ADR-0025 — Explicit SERVICE federation](0025-explicit-service-federation.md) | Proposed | Optimize only explicit SERVICE clauses within endpoint, egress, resource, and SILENT-semantics bounds |

ADR-0018 through ADR-0025 are living implementation decisions for outstanding
work. Their Proposed status is deliberate: the corresponding G1-G3 tasks and
promotion evidence are not implemented merely because the architecture is
recorded.

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
2026-08-25. Individual sealed results retain their original evidence dates;
ADR-0012 records that its July Jena receipt is stale against current HEAD, and
the claim ledger also marks the Agentic inventory and OxDatalog mutation
binding as open for current qualification.
Working Draft and editor-draft material is never described as a W3C
Recommendation.
