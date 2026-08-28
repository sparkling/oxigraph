# Linked-data-store implementation and evolution harness plan

- Status: active execution plan; unattended Dream Machine activation blocked
- Date: 2026-08-24
- Updated: 2026-08-28
- Repository: `oxigraph/oxigraph` clone maintained by this fork
- Previous programme baseline: `oxigraph/oxigraph`
  `8dcfb6b66cbb077bb2406379abb280d2471970d7`
- Audited upstream head:
  `ec68e3ddb2e73470ae5940c44709e041762afa41`
- Audited two-parent upstream merge/tree:
  `e9d2db1b7c4eb974b406136e667e09ba06e34b48` /
  `fcc5bb75c469fbbf80f77bc330279d3a7c593bfe`
- Engineering control checkpoint before this documentation slice:
  `45121da9`
- Semantic Builder handover reviewed against:
  `e1097e482476030f012da538151fd967614fb619`
- Product plan:
  [persistence writes and linked-data-store parity](persistence-write-and-linked-data-parity-plan.md)
- Harness decision:
  [ADR-0017](../adr/0017-repository-evolution-and-evidence-promotion-harness.md)
- Write-interface decision:
  [ADR-0016](../adr/0016-backend-neutral-transactional-writes.md)
- Outstanding capability decisions:
  [ADR-0018 and ADR-0020 through ADR-0033](../adr/README.md)

## Outcome

Use a thin Ruflo control plane to execute the existing product plan. Reuse the
repository's Agentic-QE, Jena, W3C, mutation, and MetaHarness runners as the
only evidence authorities. Keep two MetaHarness paths distinct: the existing
`tools/metaharness` package remains a receipt-sensitive semantic qualifier,
while the private `tools/engineering-harness` package routes, builds, repairs,
and reviews application candidates without promotion authority. The green
G1.1 reference oracle, separate red G1.2 evaluator, and source-bound G1.2-G1.4
product slices have landed. G1.5's unified-egress profile and G1.5b's
owned-update cancellation profile are also source-bound. G1.5c negotiated
backend admission is accepted by its frozen 5/15/21 evaluator split. G1.6
runtime-derived service claims are implemented and accepted by their frozen
seven-stage 4/17/1/1/12 evaluator split. G1.4a is implemented in `2f518e04`:
its frozen seven-stage verifier accepted exact patch `3a196063...` as candidate
tree `390bb43a...` for counts 7/9/20/3/2, closing the built-in Store
terminal-outcome and durable-lookup boundary before G1.7. G1.4b product
commit `590a3229` then closes the evaluator-separated simulated storage-call
fault gate: exact red 6/2 became green 8/8 while the 7/7 outcome and 20/20
compatibility controls stayed green; receipt `d4a54f90...` and its exact
replay both returned `ACCEPT`. That result does not claim crash, power-loss,
or fsync durability. G0.1-G0.7 retain their historical task closures, and
scoped schema-v5 Agentic receipts are sealed for subject
`5a93890f`; no aggregate receipt follows.
G1.7 contract v7 is integrated and independently audited through `d1e18c6e`.
Its exact merged-product subject is `e9d2db1b...`; its control authorization and
final decision set remain
proposed/unapproved, so `run` exits 4 before identity, evidence, build, or
sampling and writes no G1.7 run. Legacy v1/v3/v4/v5/v6 replay is Darwin-free
and the exact G1.4b prerequisite is bound. V7 preserves v6's canonical sample
bytes, paired negative/A/A estimators and seeds, the MAD boundary, and
mechanical verdict precedence. Commits `d3af2e17` and `45121da9` complete pure
benchmark-owner bundle verification and bounded canonical control-receipt
candidate replay across four builds, two controls, and 392 launches. The result
is `CANDIDATE_REPLAYED`, `finalDecisionEligible: false`, and `binding: null`.
It does not prove write-once creation, receipt-last order, fsync, ownership,
mode/nlink, or inventory stability. The physical sealed-envelope replay and
control/qualification execution owners are absent. Human Phase A approval and
sealed negative/A/A controls must precede Phase B's final decision set and
subject/reference qualification. Full MetaHarness semantic qualification, its
independent verification, G1.7 qualification, and separate human promotion
remain open.
Audited upstream merge `e9d2db1b` is sealed as the exact product/tree/lock
identity while v6 remains an exact historical fixture. Pure reseal task
`task-1787888366495-gzxbhe` is complete at that non-executing boundary; it
authorizes no provider, control, sample, benchmark, qualification, promotion,
or publication execution.
Darwin may improve frozen harness policy only. Dream Machine 0.1.1 is
installed and locally exercised, but it is not configured, scheduled, or
authorized to publish because its current config cannot enforce this
repository's native-provider-only and local-only boundaries.

The first implementation objective was to establish the truth of
concurrent-write semantics. The RocksDB readable transaction is a
snapshot plus `WriteBatchWithIndex`, committed by
`rocksdb_write_writebatch_wi`; it does not use RocksDB `TransactionDB`,
optimistic transactions, `GetForUpdate`, or conflict validation. The honest
current claim is stable reads, read-your-writes, and atomic batch application,
not snapshot isolation or serializability under concurrent RocksDB writers.

The implemented baseline is one-writer serialization for RocksDB,
matching the observable one-writer/many-reader model documented by
[Jena TDB](https://jena.apache.org/documentation/tdb/tdb_transactions.html).
Only adopt RocksDB pessimistic/optimistic transactions if a reproducible
write-concurrency baseline justifies the extra conflict machinery; RocksDB
documents ordinary batches and transaction conflict handling as distinct
mechanisms in its [transaction guide](https://github.com/facebook/rocksdb/wiki/Transactions).

## Current truth, completed prerequisites, and blockers

| Surface                                                   | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Disposition                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend-neutral write seam                                | Implemented and verified in `1da47285`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Preserve the minimal GAT traits; add optional capabilities through extension traits                                                                                                                                                                                                                      |
| Memory writers                                            | Serialized by the storage transaction lock                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Use as the first serial reference behavior                                                                                                                                                                                                                                                               |
| RocksDB writers                                           | G1.2 freezes the formerly red lost-update/write-skew baseline; G1.4 now proves a per-instance gate acquired before snapshot creation, held through terminal state, and bounded while queued                                                                                                                                                                                                                                                                                                                   | Advertise only the proven serialized-writer profile; evaluate OCC/TransactionDB only if G1.7 measurements justify a separate hypothesis                                                                                                                                                                  |
| Built-in remote egress, owned updates, and service claims | G1.5's frozen 12/8/13 evaluator proves one deny-by-default policy across `SERVICE`, `LOAD`, and nested document retrieval; G1.5b's 6/6/12 profile proves typed cancellation across built-in admission, local mutation, and the owned pre-commit boundary; G1.5c's 5/15/21 profile carries the exact request/token through negotiated custom and `Store` admission; G1.6's seven-stage 4/17/1/1/12 profile derives deterministic service claims from effective handlers, egress policy, and compiled transport | Advertise only those proven configured-and-compiled profiles; do not present capability disclosure as remote health or current admission                                                                                                                                                                 |
| Jena differential                                         | G0.3 refreshed the reviewed protected profile in `22a8033e`; two complete 76-scenario/198-assertion runs produced byte-identical artifacts for subject `182972ec...` and receipt `7209da6a...`                                                                                                                                                                                                                                                                                                                | Scoped task complete and reconciled by G0.7; later protected-source drift reopens it, and promotion remains separate under G1.7                                                                                                                                                                          |
| Jena runner lock                                          | G0.2 restored the reviewed `runner/Cargo.lock` strategy in `46ef17fc`, so the pinned runner executes with `--locked` from a clean checkout                                                                                                                                                                                                                                                                                                                                                                    | Scoped task complete; retain the lock as protected evidence                                                                                                                                                                                                                                              |
| Agentic-QE CLI inventory                                  | G0.4-G0.5 in `253a2b34` established the profile; current source binds 144/144 default, 129/129 no-default, and 45/45 `persistence-write` inventories; at tracked-clean subject `5a93890f`, independently reopened schema-v5 runs pass adapter 40/40, persistence 45/45, and G1 66/66                                                                                                                                                                                                                          | Scoped authority only; the receipt dirty bit reflects protected untracked runtime paths, the 47-command aggregate profile is unrun, and native commands remain authoritative                                                                                                                             |
| Pinned source checkouts                                   | G0.1 initialized and verified the RDF Canon, JSON-LD API, JSON-LD Streaming, and N3 registered revisions                                                                                                                                                                                                                                                                                                                                                                                                      | Scoped task complete; every fresh verifier must still initialize those exact registrations rather than substitute parent HEAD                                                                                                                                                                            |
| Mutation receipt                                          | G0.6 immutable run `731e6467-2cab-4260-8d15-b34e4ebc8ed6` binds the current generic OxDatalog D0-D2 snapshot under `cargo-mutants` 27.1.0: 358 generated, 278 caught, 80 unviable, zero missed/timeouts                                                                                                                                                                                                                                                                                                       | Scoped task complete; this is not persistence-write mutation coverage or umbrella qualification                                                                                                                                                                                                          |
| MetaHarness                                               | 16/16 MetaHarness tests pass; G0.7 protects root README plus ADR/plan/research claims                                                                                                                                                                                                                                                                                                                                                                                                                         | The prior synthetic receipt is stale after the protected-input change; full qualification and independent verification remain open, while G1.7 promotion is separate                                                                                                                                     |
| Engineering MetaHarness                                   | Separate local-only package, native worker adapters, Router history, sealed reconstruction, one-session sandbox, digest evidence, one exact ordered nine-task registry, and its exact generated 33-command registry are implemented; G1.2-G1.6, including G1.4a-G1.4b, have source-bound accepted candidates                                                                                                                                                                                                  | Preserve separation from semantic qualification; generic APIs select registered task IDs only, CLI slugs resolve through that registry, and each later task still needs its own direct evaluator and exact verifier artifact                                                                             |
| G1.7 qualification control                                | Outer receipt v1 and exact contract v7 `42ed3867...`; control authorization `31b8fce5...` and final decision set `b0def4f0...` are proposed/unapproved. Pure fixtures cover strict current-v7, exact v5/v6 archives, Darwin-free legacy v1/v3/v4/v5/v6 replay, authorization-bound sample bytes, paired control statistics, exact G1.4b projection/binding `d57eb7cb...`/`5a4f5721...`, the exact merged-product identity, pure benchmark-owner replay, and bounded canonical receipt-candidate replay        | `run` exits 4 before work and writes no G1.7 run. Candidate replay is non-eligible and binding-null; the physical sealed-envelope replay, production control/qualification owners, both human approvals, live controls and samples, benchmark, qualification, and separate human promotion remain absent |
| Generic MetaHarness read layer                            | Genome ready, risk 0.21, score 71/100; point-in-time OIA dry-run reported clean                                                                                                                                                                                                                                                                                                                                                                                                                               | Advisory only; OIA identifies an unknown generic harness, produced no durable receipt, and cannot promote code                                                                                                                                                                                           |
| Dream Machine                                             | User-scoped 0.1.1 CLI installed; deterministic compile; missing-ledger fallback observed                                                                                                                                                                                                                                                                                                                                                                                                                      | Local utility only; the fallback is not ledger proof, and there is no schedule, committed generated prompt, repository config, or publication                                                                                                                                                            |

The installed source-backed infrastructure audit is **OIA** (Open
Infrastructure Architecture). No OVA-named component was found in Dream
Machine, Ruflo, the Brain corpus, or the installed plugin source.

## Scope

This plan executes every planned P0-P2 capability in the product plan:

- P0: backend conformance, truthful isolation/capabilities/errors, egress,
  cancellation, runtime-derived service claims, and performance protection;
- P1: namespaces, normalized change sets, commit receipts, durable outbox,
  transaction-time SHACL, backup/restore, and observability; and
- P2: statistics and join planning, text, spatial, and federation, in that
  order after correctness and operations are stable.

The explicit product decisions now recorded by ADR-0026 through ADR-0033 form
G4. They do not inherit implementation authority from comparison breadth:
identity, workload governance, safe upgrades, RDF4J REST interoperability,
leased remote transactions, multi-repository lifecycle, incremental
entailment, and analytical execution each retain a separate evaluator and
promotion gate. Jena assemblers/proprietary formats, binary RDF formats,
clustering, distributed transactions, and automatic cross-node failover remain
outside the programme until a further named decision admits them.

## Repository fit

| Tool or practice                     | Use now                                                                                                                          | Activation boundary                                                                                                                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ruflo hierarchical-mesh swarm        | Three independent research/review lanes, persistent task dependencies, anti-drift state                                          | Task completion is not semantic evidence                                                                                                                                                                 |
| Ruflo goals and memory               | GOAP state, exact research findings, replayable decisions                                                                        | Repository facts stay repository-local; active-WAL retrieval failures do not block delivery                                                                                                              |
| Brain                                | Source-ground Darwin, Ruflo, OIA, and Dream Machine claims                                                                       | Local source/tests remain authoritative for Oxigraph                                                                                                                                                     |
| MetaHarness genome/score/OIA         | Readiness and risk diagnostics                                                                                                   | Generic identity and scores are advisory                                                                                                                                                                 |
| Existing `tools/metaharness` adapter | Policy-only qualification against immutable local oracles                                                                        | Synthetic mode never upgrades to semantic proof; do not make it a worker host                                                                                                                            |
| `tools/engineering-harness`          | Native-worker routing, isolated builds/repairs, focused evaluation, candidate artifacts, and canonical task/command registration | Implemented for G1.2-G1.6: generic APIs are task-ID-only and CLI slugs resolve through the same registry; accepted product candidates are current through G1.6; still no semantic or promotion authority |
| Darwin                               | Deterministic, bounded policy mutation after a product slice exists                                                              | `--confirm` requires operator review; never mutate product or oracle inputs                                                                                                                              |
| Dream Machine                        | Version/help, stdout-only config inspection, deterministic compile in temporary storage, ledger validation vocabulary            | ADR-0017 prerequisites 1-7 must be current and gate 8 must authorize the exact run before a runner/config is committed or scheduled                                                                      |

Dream Machine's published CLI makes no provider call and needs no model key;
`/schedule` only emits workflow JSON and defaults to a Claude model. It is the
optional disabled research workflow that hard-codes OpenRouter, while the
compiled routine includes an `OPENROUTER_API_KEY` example, creates a public
gist, branches, pushes, files an issue, and opens a draft PR. `autoMerge: false`
prevents neither publication nor shell execution. The npm artifact and current
source also carry the same version while exposing different commands. Do not
repair this by hand-editing generated output; require enforceable
compiler/config support.

## DDD bounded contexts

| Context                 | Owns                                                                                     | Must not own                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Dataset query           | `QueryableDataset`, snapshots, algebra reads                                             | Mutation, commit, or operational policy                              |
| Transactional mutation  | `TransactionalDataset`, `WritableDataset`, graph topology, transaction states            | Bulk-loader batching, backup, or secondary-index implementation      |
| Bulk ingest             | Large files, batching, per-file/cross-file atomicity                                     | Interactive transaction guarantees it cannot meet                    |
| Commit governance       | Capability negotiation, writer gate/conflicts, change-set orchestration, receipt, outbox | Validation policy/semantics, query planning, or index-specific types |
| Egress and cancellation | `SERVICE`, `LOAD`, JSON-LD fetch policy, deadlines, byte budgets, typed failures         | Commit replay or authorization decisions                             |
| Semantic validation     | Validation policy and a pinned SHACL profile over the staged view                        | Network access, writer-gate ownership, or independent commit         |
| Derived state           | Statistics, text, and spatial providers, cursors, rebuilds                               | Primary truth; every optimization retains an exact fallback          |
| Federation              | Endpoint catalog, source selection, bound joins, per-endpoint budgets                    | Egress-policy bypass or remote correctness assumptions               |
| Operations              | Metrics, readiness, backup, restore, compaction, recovery receipts                       | RDF/query/user payloads in default telemetry                         |
| Evidence and evolution  | Frozen evaluators, receipts, policy variants, human promotion                            | Product semantics or autonomous publication                          |

Evidence repair and concurrency truth start in parallel. Evidence repair blocks
promotion and full qualification, not local state-model or concurrency-test
development. The product dependency spine is:

`concurrency truth -> transaction contract -> egress/cancellation -> change set/receipt/outbox -> SHACL/operations -> statistics -> text/spatial -> federation`

## SPARC specification

### Functional requirements

- **HFR-1:** The same reference model replays quad, topology, namespace,
  lifecycle, receipt, and feed operations against memory, RocksDB, and the
  rewritten persistence adapter.
- **HFR-2:** Every backend reports effective capabilities and rejects a
  requested minimum it cannot meet; no capability is inferred from a type name
  or compile feature.
- **HFR-3:** A transaction attempted at the durability boundary returns
  committed, rejected only when non-commit is proven, or indeterminate with a
  lookup key; after reopen that key resolves to committed or proven absent
  without replaying effects. It never rewrites an unknown outcome as rollback.
- **HFR-4:** The transaction key, commit ID, primary data, graph topology,
  namespace changes, receipt, and outbox position become durable as one commit.
- **HFR-5:** SHACL validates the complete staged view under the same concurrency
  gate as commit before any primary or derived state is published.
- **HFR-6:** Every derived index exposes freshness and retains a correctness
  path independent of that index.
- **HFR-7:** Each candidate uses immutable evaluators, parent-first baseline,
  one frozen hypothesis, one conceptual change, and exactly one verdict.
- **HFR-8:** Candidate verification restores the pinned baseline, overlays the
  evaluator commit, applies the admitted patch, rebuilds every declared target,
  and only then runs the focused evaluator set against the fresh artifacts.

### Non-functional requirements

- Every randomized failure records a seed and shrinks to a replayable trace.
- Telemetry, cancellation, and egress logs exclude query text, RDF payloads,
  credentials, IRIs, commit IDs, and user IDs by default. Receipts necessarily
  bind transaction/commit identifiers but exclude RDF payloads, credentials,
  and user identifiers.
- No provider call, network publication, merge, or schedule occurs without
  explicit active-task authorization.
- Harness work stays below 20% of an implementation slice unless an operator
  explicitly changes the proportionality gate.
- Product and harness writers use separate worktrees; concurrent Cargo lanes
  use separate `CARGO_TARGET_DIR` values.

### Transaction-state pseudocode gate

```text
begin(request):
  capabilities = backend.capabilities()
  reject unless capabilities.satisfies(request.minimum)
  acquire the bounded, cancellable writer gate before snapshot creation
  pin snapshot, shapes version, deadline, transaction key

stage(operation):
  check cancellation and resource budgets
  update coherent dataset/topology/namespace view
  record normalized net semantic effect

commit():
  honor cancellation before atomically entering CommitAttempted
  validate full staged data and resulting staged shapes under the writer gate
  atomically write transaction key + commit ID + primary state + receipt + outbox
  hold the gate through commit, rollback, or drop
  return committed(commit_id), rejected only if non-commit is proven,
  or indeterminate(transaction_key) if the durable outcome cannot be observed

rollback_or_drop():
  discard staged state and release the writer gate

reopen_and_lookup(transaction_key):
  return committed(receipt), proven_absent, or indeterminate
  never replay effects to discover the answer
```

Automatic replay is forbidden for `LOAD`, `SERVICE`, custom functions, or any
operation that has not proven idempotency.

## GOAP delivery graph

### ADR ownership map

ADRs record architecture; the stable G-identifiers record executable work.
Proposed ADRs do not become implemented merely because their task rows exist.

| Plan work                                                    | Owning decision                                                                                                                                                                                                                 | Decision status                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0.1 source registration                                     | [ADR-0017](../adr/0017-repository-evolution-and-evidence-promotion-harness.md)                                                                                                                                                  | Implemented programme control                                                                                                                                                                                                                                                                                                                                  |
| G0.2-G0.3 Jena evidence                                      | [ADR-0012](../adr/0012-immutable-broad-jena-harness.md)                                                                                                                                                                         | Accepted                                                                                                                                                                                                                                                                                                                                                       |
| G0.4-G0.5 Agentic-QE evidence                                | [ADR-0005](../adr/0005-agentic-qe-integration.md)                                                                                                                                                                               | Accepted                                                                                                                                                                                                                                                                                                                                                       |
| G0.6 mutation evidence                                       | [ADR-0013](../adr/0013-mutation-competence-and-provenance.md)                                                                                                                                                                   | Accepted                                                                                                                                                                                                                                                                                                                                                       |
| G0.7 evidence freeze/promotion                               | [ADR-0004](../adr/0004-metaharness-darwin-qualification.md), [ADR-0017](../adr/0017-repository-evolution-and-evidence-promotion-harness.md)                                                                                     | Accepted qualification policy; implemented engineering control                                                                                                                                                                                                                                                                                                 |
| G1.1-G1.4b transaction truth                                 | [ADR-0018](../adr/0018-transaction-guarantees-and-conflict-model.md)                                                                                                                                                            | Product slices complete through G1.4b; ADR remains Proposed until G1.7                                                                                                                                                                                                                                                                                         |
| G1.5-G1.6 egress/cancellation/claims, including G1.5b-G1.5c  | [ADR-0019](../adr/0019-unified-egress-cancellation-and-service-claims.md)                                                                                                                                                       | Implemented                                                                                                                                                                                                                                                                                                                                                    |
| G1.7 qualification and promotion                             | [ADR-0017](../adr/0017-repository-evolution-and-evidence-promotion-harness.md), [ADR-0018](../adr/0018-transaction-guarantees-and-conflict-model.md), [ADR-0019](../adr/0019-unified-egress-cancellation-and-service-claims.md) | Audited fail-closed v7 identity and v6 two-phase/statistics semantics, Darwin-free legacy replay, exact G1.4b binding, and pure owner/receipt-candidate replay are implemented; production/physical owners, a physically sealed receipt and replay-derived binding, human approvals, qualification, and human promotion remain open; ADR-0018 remains Proposed |
| G2.1-G2.3c metadata/receipts/outbox                          | [ADR-0020](../adr/0020-transactional-metadata-receipts-and-change-delivery.md)                                                                                                                                                  | Proposed                                                                                                                                                                                                                                                                                                                                                       |
| G2.4a-G2.4b transaction-time SHACL                           | [ADR-0021](../adr/0021-transaction-time-shacl-validation.md)                                                                                                                                                                    | Proposed                                                                                                                                                                                                                                                                                                                                                       |
| G2.5-G2.7 readiness/recovery                                 | [ADR-0022](../adr/0022-operational-readiness-backup-and-recovery.md)                                                                                                                                                            | Proposed                                                                                                                                                                                                                                                                                                                                                       |
| G3.1-G3.2 statistics/planning                                | [ADR-0023](../adr/0023-statistics-and-bounded-join-planning.md)                                                                                                                                                                 | Proposed                                                                                                                                                                                                                                                                                                                                                       |
| G3.0 shared lifecycle plus G3.3-G3.4 derived-index providers | [ADR-0022](../adr/0022-operational-readiness-backup-and-recovery.md), [ADR-0024](../adr/0024-rebuildable-derived-indexes.md)                                                                                                    | Proposed                                                                                                                                                                                                                                                                                                                                                       |
| G3.5 explicit federation                                     | [ADR-0025](../adr/0025-explicit-service-federation.md)                                                                                                                                                                          | Proposed                                                                                                                                                                                                                                                                                                                                                       |
| G4.1 service identity/authorization                          | [ADR-0026](../adr/0026-service-identity-and-authorization.md)                                                                                                                                                                   | Proposed                                                                                                                                                                                                                                                                                                                                                       |
| G4.2 workload/resource governance                            | [ADR-0027](../adr/0027-workload-admission-and-operator-resources.md)                                                                                                                                                            | Proposed                                                                                                                                                                                                                                                                                                                                                       |
| G4.3 storage schema upgrades                                 | [ADR-0028](../adr/0028-safe-storage-schema-upgrades.md)                                                                                                                                                                         | Proposed                                                                                                                                                                                                                                                                                                                                                       |
| G4.4 RDF4J REST interoperability                             | [ADR-0029](../adr/0029-rdf4j-rest-interoperability.md)                                                                                                                                                                          | Proposed                                                                                                                                                                                                                                                                                                                                                       |
| G4.5 leased remote HTTP transactions                         | [ADR-0030](../adr/0030-leased-remote-http-transactions.md)                                                                                                                                                                      | Proposed                                                                                                                                                                                                                                                                                                                                                       |
| G4.6 multi-repository lifecycle                              | [ADR-0031](../adr/0031-multi-repository-lifecycle.md)                                                                                                                                                                           | Proposed                                                                                                                                                                                                                                                                                                                                                       |
| G4.7 incremental entailment                                  | [ADR-0032](../adr/0032-incremental-entailment-projections.md)                                                                                                                                                                   | Proposed                                                                                                                                                                                                                                                                                                                                                       |
| G4.8 analytical/WCOJ research                                | [ADR-0033](../adr/0033-analytical-wcoj-execution.md)                                                                                                                                                                            | Proposed                                                                                                                                                                                                                                                                                                                                                       |

### G0 — repair and freeze evidence

Run three independent lanes, then integrate sequentially:

| Task                                                      | State                                                             | Owner lane  | Depends on | Exit gate                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------- | ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G0.1 Initialize registered source submodules              | Complete                                                          | Evidence    | none       | Source verifier saw exact registered checkout heads rather than the parent repository                                                                                                                                                                                                |
| G0.2 Restore Jena runner lock reproducibility             | Complete (`46ef17fc`)                                             | Evidence    | none       | Clean checkout executes the pinned `--locked` runner                                                                                                                                                                                                                                 |
| G0.3 Review current Jena subject and refresh profile lock | Complete (`22a8033e`)                                             | Evidence    | G0.2       | Lock diff reviewed; two complete byte-identical 76/198 runs                                                                                                                                                                                                                          |
| G0.4 Reconcile Agentic-QE exact CLI counts/IDs            | Complete (`253a2b34`)                                             | Evidence    | none       | 144 default and 129 no-default inventories deliberately accepted                                                                                                                                                                                                                     |
| G0.5 Add `persistence-write` evidence profile             | Complete (`253a2b34`; inventory refreshed in the current tranche) | Conformance | none       | 45 exact executed IDs cover transactional dataset, update atomicity, topology, service claims, and failure injection; the separately owned ignored compatibility canary remains in G1.6                                                                                              |
| G0.6 Verify and regenerate OxDatalog mutation receipt     | Complete (run `731e6467-2cab-4260-8d15-b34e4ebc8ed6`)             | Evidence    | none       | Mutation tests pass; registry-latest `cargo-mutants` 27.1.0 was acquired without a top-level version constraint; 358 = 278 caught + 80 unviable with zero missed/timeouts; immutable and latest receipt bytes both have SHA-256 `fc0ec6db...` and reopen against input `9898ef56...` |
| G0.7 Reconcile and freeze protected evidence documents    | Complete (2026-08-26 checkpoint)                                  | ADR/claims  | G0.1-G0.6  | Ledger, root README, ADRs, plans, research, and the visual report distinguish historical, current-scoped, aggregate-qualified, and promoted evidence; README is now a protected MetaHarness input                                                                                    |

No lock, expected count, manifest, threshold, or receipt is refreshed
automatically by Dream Machine or Darwin.

### G1 — make P0 transaction claims true

| Task                                              | Depends on                        | Size | Exit gate                                                                                                                                                                                                                                                                               |
| ------------------------------------------------- | --------------------------------- | ---: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1.1 State-machine reference model                | none; run beside G0               |    L | At least 10,000 shrinking traces/backend in CI; every failure has a seed                                                                                                                                                                                                                |
| G1.2 Concurrent history oracle                    | G1.1                              |    M | Lost-update/write-skew schedules expose current behavior; zero silent anomalies across the frozen stress budget                                                                                                                                                                         |
| G1.3 Typed request/capability/error extensions    | G1.1-G1.2                         |    L | Effective guarantee returned; unmet minimum rejected; conflict and indeterminate outcomes typed                                                                                                                                                                                         |
| G1.4 RocksDB writer serialization                 | G1.2-G1.3                         |    M | Bounded/cancellable gate acquired before snapshot and held through commit/rollback/drop; advertised guarantee passes the 1/4/16-writer oracle while readers remain concurrent                                                                                                           |
| G1.4a Built-in Store terminal outcomes and lookup | G1.4                              |    L | One `CommitAttempted` transition; typed terminal outcomes; transaction-key reservation and committed/proven-absent/indeterminate lookup; RocksDB reopen resolves lost acknowledgements without replay; legacy minimal traits remain source-compatible                                   |
| G1.4b Outcome phase-fault safety                  | G1.4a                             |    S | Evaluator-separated pre/post storage-call faults cannot produce a false rollback proof after commit attempt; malformed records are corruption; durable Staging/CommitAttempted remain indeterminate; crash/power-loss/fsync stay explicit non-claims                                    |
| G1.5 Unified remote egress                        | G1.3                              |    L | Loopback SSRF/redirect/size/timeout fixtures and remote update rollback pass                                                                                                                                                                                                            |
| G1.5b Owned-update cancellation                   | G1.5                              |    M | Built-in admission, validation, mutation loops, and the final pre-commit checkpoint return typed cancellation and roll back owned state                                                                                                                                                 |
| G1.5c Negotiated backend admission                | G1.5b                             |    M | An additive negotiated binding carries the exact token and request through custom and Store admission without breaking the minimal write trait                                                                                                                                          |
| G1.6 Runtime-derived service claims               | G1.3, G1.5, G1.5b, G1.5c          |    M | Complete: seven ordered verifier stages accepted exact public/service/compatibility/independent/regression counts 4/17/1/1/12, and three product controls rejected                                                                                                                      |
| G1.7 Compatibility/performance and promotion gate | G0.1-G0.7, G1.1-G1.6, G1.4a-G1.4b |    M | Exact G1.4b receipt copied/replayed; human-authorized negative/A/A controls sealed and replayed; one final decision set binds that receipt before subject sampling; current semantic/compatibility owners and paired benchmark replay clean; `ACCEPT` awaits a separate human promotion |

`HARNESS-REGISTRY` and `HARNESS-REJECTION-EVIDENCE` are harness-maintenance
controls, not new product G tasks. The registry control follows G1.6 and is
implemented by commit `4a15caa07df37d884e7c74d4b69c0505ce3de6e1` with an
exact ordered seven-task registry, task-ID-only generic APIs, and an exact
ordered 27-command surface. The rejection-evidence control follows it and is
implemented by commit `afe30c7de7e3df6e72a0a855d83efc612339f261`:
application receipt v6 persists bounded candidate-specific
reconstruction/applicability failures, binds each to its exact successful
patch-producing invocation, and replay-verifies exact attempt-or-rejection
accounting. Both harness controls are closed. G2.1's evaluator may now be
frozen once G2.1's own prerequisites are current. The dependency edge remains
G1.6 → `HARNESS-REGISTRY` → `HARNESS-REJECTION-EVIDENCE` → G2.1
evaluator freeze.
Commits `13352ff9` and `c2497225` subsequently add the evaluator-separated
G1.4a profile without rewriting the historical registry receipt. Commits
`1362f250`, `3bb4f0fb`, and `695def8d` do the same for G1.4b. The current
derived surface is nine tasks and 33 commands; 338 runnable tests pass and two
native-host fixtures skip by their declared host gate.

Execution record through 2026-08-28:

- G1.1 is complete in `3edfb86a`: 10,000 deterministic shrinking traces each
  passed for memory, RocksDB, and the test-only
  `RewrittenPersistencePlane` portability adapter. The full
  public run took 169.73 seconds and supports one-seed replay through
  `OXIGRAPH_TX_TRACE_SEED`.
- G1.2 oracle construction is complete in evaluator-only commit `eaf7161c`.
  Its frozen product baseline is intentionally red: both histories observe
  overlapping writers and reproduce lost update and write skew. Product commit
  `7eec1f07` adds a per-instance RocksDB writer gate and closes both anomalies.
- G1.3 is complete in product commit `3bf9468c`. Frozen contract
  `fd30c797263e3f0b001c816c56cdacbeee095fa4da1ad948a6211734b982a461`
  reconstructed exact patch `2d5412df6210246266426e3b7ee8be599744fc1093c9ac272b8d8d64a34fef04`
  and accepted format, build, 9 public capability tests, 3 independent
  state-model tests, and 3 transactional regressions in the isolated harness.
- G1.4 is complete in product commits `b2ed9119` and `5a704914`. Frozen
  contract
  `cc20ae29420ff2a3b328b35bdc8f26dcd6cd39e978ec6fcfc0de93290334df39`
  reconstructed exact patch
  `47bfdb31333a13ba5d90bca3f06767fe889f05c0e9aebf5b3628d3942eafa7db`
  as candidate tree `7d47e7352d64171563da8dd8d00fcb9b4c1f790d` and accepted
  format/build/public-6/independent-2/regression-2 in 313.959 seconds. The
  writer gate passed its 1/4/16-writer, concurrent-reader, drop, rollback,
  timeout, and queued-cancellation oracle. G1.4 evidence is complete.
- G1.4a is complete in product commit `2f518e04`. Frozen contract
  `fa8d1028cb3e1c27c2f1771e77451a08ddc84ce6a2c7c673c2435deda574a6fd`
  reconstructed exact patch
  `3a19606349d057c8090c8a92d336761c554ae32d011d9759948b602a54ca7d54`
  as candidate commit `de43f6e2e361095d61741f4aaafebb611e91a474`, tree
  `390bb43a5a3157f873204c63c10355026aab5681`, retained the 1,473-entry
  protected manifest
  `54162db0dd0f4dfebb78cade7d136daa16d403f3e520a1b295860a99ea56999c`,
  and returned `ACCEPT` for format/build/public-7/service-9/
  compatibility-20/independent-3/regression-2 in 395.556 seconds. The session
  artifact has SHA-256
  `9c3ee4481fcc777124cad7bc6d051cdb095de1fe93987c52ef80243735ecc240`.
  Task `task-1787855156849-ya7t6b` is complete. ADR-0020 later extends the
  minimal outcome ledger with commit receipts and outbox state.
- G1.4b is complete in product commit
  `590a3229ab1a826a102d52736dc6491530b69998`. Corrected evaluator commit
  `fa832174f3023e035fbaad52721f1b616eb1752e` and contract
  `926724ae8c8d206b4a4de576eb0120fc21c75aa96c99fb4f38664a2bdf3b44c8`
  froze the exact 6/2 red signature. The application harness selected patch
  `02f10b26613ce403120bb68867ea739295225a9c630970e25911694eb94a1314`
  as candidate commit `a1ca1eb45dba23c246ce84f70d67740c9bd388ab`, tree
  `ab5b281da2ee40c12122a9598d19d33b699d0b86`; receipt
  `d4a54f90ab4edbbb86ee7b76a984ad97032e5e8abb3d884583c90ec3ed6c03ad`
  and exact replay both returned `ACCEPT`. Direct post-application evidence is
  8/8 fault, 7/7 outcome, and 20/20 compatibility tests. Task
  `task-1787869201628-bwe6b0` is complete. Corrected G1.7 task
  `task-1787871483413-ki34q2` is in progress at 55%. Contract v7's merged-product
  identity and v6's two-phase protocol and exact paired control statistics are
  implemented and audited, v1/v3/v4/v5/v6 legacy replay is Darwin-free, and the exact G1.4b receipt is
  bound at the current prerequisite boundary. This harness-only slice does not
  increase product progress. Pure benchmark-owner bundle and bounded canonical
  control-receipt candidate replay are complete in `d3af2e17`/`45121da9`. The
  remaining sequence begins with the dedicated physical envelope and sealed
  archive replay, then workspace/build/containment and live control owners,
  genuine human Phase A control approval, sealed and replayed negative/A/A
  controls, human Phase B's final decision binding, regenerated current owner
  evidence, the isolated paired benchmark and owner replay, and a separate
  human promotion decision.
  The G1.4b result covers injected storage-call branches, not crash,
  power-loss, or fsync durability.
- G1.5's unified-egress profile is implemented in product commits `e452bad1`
  and `3f4cdfd7`. Frozen contract
  `e77e11a02e55e995583f0bab118878a42c490b562e0826c6b1611db096c6dfec`
  reconstructed exact patch
  `88ba98acece42a0dc595c9b44951de90fe7f0c2a0c33c3f6bf0cad95ff36c3cc`
  as candidate commit `dce82860d028d675471b6990127d143a66144e82`, tree
  `ee4562f93bfa8558a931806bc4d8934df187506f`, and returned `ACCEPT` for
  format/build/public-12/independent-8/regression-13 in 308.871 seconds. The
  frozen evaluator is `f1fa7900191a4eaffd2d9c92694851152a5e4fb1`; its
  1,382-entry protected manifest is
  `5f7c03cef435fd8ed8750b6ce13f8807481413e75dc1b943dbc118fdd9ccda30`,
  and the verifier artifact is
  `4d1f9df209046b439db07346a22f2b4c9063f80b913d2a752abcc7a1123234eb`.
  This receipt closes the frozen remote-egress profile.
- G1.5b's owned-update cancellation profile is implemented in product commits
  `280872dc` and `9b84bed6`. Frozen contract
  `ab01ef3e29fbded8c8c042359851bd0c02c9fa1fd97afbc00eadc0b3a48e1525`
  reconstructed exact four-path patch
  `ccf256b17f4ea01be82025485bc9bd20d4d9868c0307be922009f87792a9743f`
  as candidate commit `33a0eefb5ee6a84e3a12a5585eec1ebf3a35a86a`, tree
  `d5413be86dae88f4b353ef4979ca8307f408357d`, and returned `ACCEPT` for
  format/build/public-6/independent-6/regression-12 in 431.682 seconds. The
  frozen evaluator is `776b212dda26a4967f82098a90ade4c2d83aade1`; its
  1,386-entry protected manifest is
  `65cedf8d5a2cb289b3cd60d929fbc04fbbd1332e508a2bfd697f738b51c2c0f3`,
  and the verifier artifact is
  `4f6107ca9357ccc15b353a858729e8110495ec5079a40785f2edb9a83ca18f48`.
  The receipt covers transactions owned by the update binding; caller-owned
  transactions require caller rollback and remain outside it.
- G1.5c's negotiated backend-admission profile is implemented in product
  commit `3afe1e78`. Frozen contract
  `05b6ba498344fc412a810bb79eb80344f90577a442ce03c41637cbabd4a26ce1`
  reconstructed exact patch
  `229d326bb22f46b992bc6d6212be1346de88b0d5bf1b9cad56dc0150611066c8`
  as candidate commit `bbbbc5aa6b1cb1ba283c272e1f87fbc53483b728`, tree
  `40137fa6306e8c282da16fbeb0d46418e27d0f3a`, retained protected
  manifest `f0d009cd1b48b6c850b45026a2956fea752c8e9cf932022d7e34aa37cf5fb2bb`,
  and returned `ACCEPT` for format/build/public-5/independent-15/regression-21
  in 1,337.018 seconds. The frozen evaluator is `fbd11e18`; the verifier
  artifact is
  `94461758757f1d4402713f6bed115e1bbd318d1fc35b02c7ea2c3b27a2b3f23b`.
  This closes negotiated admission without adding savepoints or changing the
  caller-owned rollback boundary.
- G1.6's runtime-derived service-claim profile is implemented in exact product
  commit `96d0ae7b177026506f4c8bfc74cf2eb88e71abc4` and integrated unchanged in
  merge commit `baeabb067c8c8419973842e5e060adf832e3f738`. Evaluator commit
  `8dcb795a08e3605c18c662d13b040311a260ac2b`, tree
  `973d5ed5615fc2f34a1e9d0da657d01f5c899755`, evaluator patch SHA-256
  `93893693ed9804d56589169168c4dcd464bdeef2bc8dfea9e0eee0689888cee6`,
  contract SHA-256
  `abd16ee2f4d2c7c4b89b651e9412e126cac468456e7a1633c1143dce1f5accd3`,
  and the 1,398-entry protected-manifest SHA-256
  `a5c3f5c448a9aa1a615f7b4b1d60b8c5e43965240c5981acb66fa356831b155f`
  bound the run. An exact `CONFIRMED_RED` preflight preserved green reference
  stages and the expected failing compatibility canary. The accepted product
  patch SHA-256
  `6ac04ebee08ce571e403a3937c41d258521bf9e172b2f3e666949266b73239b3`
  reconstructed tree `269ccb9b519c6beaf311bfc9ec5c7539acb79498` and returned
  `ACCEPT` for the seven ordered format/build/public-4/service-17/
  compatibility-1/independent-1/regression-12 stages in 1,153,499 ms. Its
  126,368-byte verifier artifact has SHA-256
  `4ff0fdafa3b8584f81033a89000814320a952bbc384523cd72dd57150963458b`.
  Three exact product controls rejected as required:

  - the earlier-product patch
    `1b30556c3392aaf1a4f0041ce3f69fd00a929fba4fd62ee2b4c04edb6297566e`
    (tree `7b3cf9567cd6ca763165f38727675dec66870c00`, candidate
    `9aad0121280e32ddbbc0893c4cc583d10f065eb7`) failed two service tests and
    the compatibility canary in 1,139,452 ms; its verifier artifact is
    `96dc288bc70f5d5dfb62ce02d5954330534ac7921da17e912d74af4b6a200740`
    and atomic outer evidence is
    `9e5c54a5e687948b4183bb57878764975cc0a7701a86e02ce3ab8254eb89287c`;
  - the union-only patch
    `543379f0df24e5f8e144239d7dc674e1e618521494fa9f0c7b2132b12e88e330`
    (tree `f249d49ebf440734e0e05368ea78ac6c0f444e52`) failed one service test in
    1,148,684 ms; its verifier artifact is
    `393b8c7239986a654e80f5213b653ea5c494fec4878b7fd79ced9a9c39321046`;
  - the CLI-TLS-gated server patch
    `e3f15a88f61711873a1e7f9f41a79fae737b8531d9f9422309ec7d488e4e9578`
    (tree `964a63bf5f91a44f569565e1fa1de7bb262ce7cd`) passed public-4 and
    service-17 but failed its one compatibility canary in 1,147,933 ms; its
    verifier artifact is
    `3635ef690d75d10d8d5b4d7b316b7c6d487d7f6e9a8b47055a0c86630e387f5d`
    and atomic outer evidence is
    `33049ddad8d1136015f7b5a866ba4ba9b8e0d2953606de9195d7ef7f17c38333`.

  A direct verifier test additionally rejects compatibility counts other than
  exactly one. These verifier-session artifacts are local-only evidence with
  `promotionAuthority: false`; they are not application receipts and grant no
  semantic-qualification or promotion authority. ADR-0019 is Implemented;
  ADR-0018 and G1.7 remain open.

- `HARNESS-REGISTRY` is complete in commit
  `4a15caa07df37d884e7c74d4b69c0505ce3de6e1`. The registry derives canonical
  `tasks/g1/<slug>/contract.json` paths for exactly G1.2, G1.3, G1.4, G1.5,
  G1.5b, G1.5c, and G1.6; the generic contract, preflight, programme, and replay
  APIs reject direct contract-path selection and unknown or malformed task
  identities before I/O. The exact generated 27-command surface, all 180
  harness tests, and the `runner-implemented` doctor pass. The doctor retains
  `latest` dependency requests, valid native Codex and Claude interfaces,
  `mcpRegistered: false`, `localOnly: true`, and `promotionAuthority: false`.
  This closed registry drift only; G0.6, G0.7, and G1.7 were still open at
  that checkpoint.
- `HARNESS-REJECTION-EVIDENCE` is complete in commit
  `afe30c7de7e3df6e72a0a855d83efc612339f261`. Current application receipt v6
  records every failed reconstruction/applicability lane independently, binds
  the exact candidate execution, successful implementation/repair invocation,
  patch digest, typed phase/code, and bounded canonical-detail digest, and
  requires each successful patch-producing invocation to have exactly one
  attempt or rejection. The records are non-trainable, v1-v5 receipts remain
  byte-exact replay-only, and candidate-disposal failure aborts receipt
  minting. All 194 harness tests and the `runner-implemented` doctor pass,
  including malformed/resigned/reordered evidence, identical-patch lanes,
  raw-detail non-retention, and frozen pre-v6 fixture controls. This closes the
  rejection-evidence control only; G0.6, G0.7, and G1.7 were still open at
  that checkpoint, and no semantic qualification or promotion authority
  followed.
- G0.6 is complete with immutable mutation run
  `731e6467-2cab-4260-8d15-b34e4ebc8ed6`. The 358 generated outcomes conserve
  exactly as 278 caught plus 80 unviable, with zero missed and zero timed out;
  immutable and latest receipt bytes share SHA-256 `fc0ec6db...`. Independent
  reopen verifies input `9898ef56...`, content `88de934c...`, execution
  `cfe719d3...`, and `cargo-mutants` 27.1.0 provenance. This is current only
  for the protected generic OxDatalog D0-D2 scope.
- G0.7 is complete for this checkpoint. Commit `70db135d` makes the source
  verifier pin the refreshed Jena, 144/129 CLI, then-34-test persistence-write, and
  mutation identities and adds root README to the MetaHarness protected set.
  The synchronized README, ADR, plan, ledger, research, and visual-report
  claims keep full MetaHarness qualification, independent verification, and
  G1.7 promotion withheld. Any later protected product or claim edit reopens
  the earliest affected receipt.
- The schema-v5 adapter hardening in `31f23aea` was such a later change.
  `e8add13c` repaired selection-aware Cargo inventory drift, and `5a93890f`
  stabilized the tool documentation before the final run. Independently
  reopened schema-v5 adapter, persistence, and G1 receipts now cover 40, 45,
  and 66 tests for that tracked-clean subject. Their broad dirty flag is caused
  only by protected untracked Ruflo/runtime paths; no aggregate receipt follows.
- The dedicated G1.7 qualification control is now exact contract v7
  `42ed3867...`. The proposed control-authorization and final-decision raw
  SHA-256 values are `31b8fce5...` and `b0def4f0...`. A current `g1.7:run`
  exits 4 at `CONTROL_AUTH_PROPOSED` with `semantic-not-run`,
  `compatibility-not-run`, and `benchmark-not-run`, before identity, evidence,
  build, runtime-directory creation, or samples, and writes no G1.7 run.
  Legacy v1/v3/v4/v5/v6 replay is Darwin-free. V7 preserves v6's exact-bound canonical sample
  framing/order, paired negative/A/A statistics and seeds, the MAD noise
  boundary, and mechanical verdict precedence. The exact accepted G1.4b
  prerequisite projection/binding is `d57eb7cb...`/`5a4f5721...`. Pure
  benchmark-owner and receipt-candidate replay is complete in
  `d3af2e17`/`45121da9`; it is non-eligible and binding-null. The full package
  suite contains 446 tests: 444 pass, none fail, and two intentional host-gated
  cases are skipped. This is fail-closed protocol and candidate-receipt
  evidence, not human approval, a physically sealed current receipt, a final
  binding, semantic qualification, live benchmark evidence, a performance
  result, or promotion.
- Contract v7 preserves v6's ordered lifecycle. Human Phase A may authorize
  only permanently non-promoting negative and independently built A/A controls
  and requires their raw owner receipt to be sealed and replayed. Human Phase B
  binds that receipt, its observed signature, and the G1.4b prerequisite into
  one final reference/performance/noise decision before any subject/reference
  sample. Neither approval has occurred; live owners and canonical receipt
  replay remain absent. `ACCEPT` remains
  `QUALIFIED_AWAITING_HUMAN_PROMOTION`; no automated promotion command exists.

Use writer serialization first. Evaluate RocksDB `TransactionDB` or optimistic
conflicts only as a later frozen hypothesis if serialization creates a measured
production bottleneck.

### G1 application-task corpus and implementation order

The engineering corpus begins with callable product behavior, not G0 evidence
repairs. G1.1 is the green reusable reference oracle. A product-repair task is
not registered with the engineering harness until its product baseline is
genuinely red under a separate evaluator-only commit; G1.2 is the first such
task.

| Task  | Evaluator path                                                                                              | Public command                                                                                                                 | Independent command                                                                                                                                                   | Impacted-regression command                                                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1.1  | `lib/oxigraph/tests/transaction_state_model.rs`                                                             | `cargo test --locked -p oxigraph --test transaction_state_model`                                                               | `cargo test --locked -p oxigraph --test transactional_dataset`                                                                                                        | `cargo test --locked -p oxigraph --test update_atomicity`                                                                                                  |
| G1.2  | `lib/oxigraph/tests/transaction_concurrency.rs`                                                             | `cargo test --locked -p oxigraph --test transaction_concurrency`                                                               | `cargo test --locked -p oxigraph --test transaction_state_model`                                                                                                      | `cargo test --locked -p oxigraph --test update_atomicity`                                                                                                  |
| G1.3  | `lib/oxigraph/tests/transaction_capabilities.rs`                                                            | `cargo test --locked -p oxigraph --test transaction_capabilities`                                                              | `cargo test --locked -p oxigraph --test transaction_state_model`                                                                                                      | `cargo test --locked -p oxigraph --test transactional_dataset`                                                                                             |
| G1.4  | `lib/oxigraph/tests/rocksdb_writer_serialization.rs`                                                        | `cargo test --locked -p oxigraph --test rocksdb_writer_serialization`                                                          | `cargo test --locked -p oxigraph --test transaction_concurrency`                                                                                                      | `cargo test --locked -p oxigraph --test update_atomicity`                                                                                                  |
| G1.4a | `lib/oxigraph/tests/transaction_outcomes.rs`                                                                | `cargo test --locked -p oxigraph --test transaction_outcomes`                                                                  | `cargo test --locked -p oxigraph --test transaction_compatibility`                                                                                                    | `cargo test --locked -p oxigraph --test update_atomicity`                                                                                                  |
| G1.4b | `lib/oxigraph/src/store/transaction_outcome_faults.rs`                                                      | `cargo test --locked -p oxigraph --lib store::transaction_outcome_faults::`                                                    | `cargo test --locked -p oxigraph --test transaction_outcomes`                                                                                                         | `cargo test --locked -p oxigraph --test transaction_compatibility`                                                                                         |
| G1.5  | `lib/oxigraph/tests/sparql_egress_policy.rs`                                                                | `cargo test --locked -p oxigraph --test sparql_egress_policy`                                                                  | `cargo test --locked -p oxigraph --test sparql_update_load_http`                                                                                                      | `cargo test --locked -p oxigraph --test sparql_service_http`                                                                                               |
| G1.5b | `lib/oxigraph/tests/sparql_update_cancellation.rs`                                                          | `cargo test --locked -p oxigraph --test sparql_update_cancellation`                                                            | `cargo test --locked -p oxigraph --test rocksdb_writer_serialization`                                                                                                 | `cargo test --locked -p oxigraph --features http-client,rdf-12 --test sparql_egress_policy`                                                                |
| G1.5c | `lib/oxigraph/tests/sparql_negotiated_update.rs`                                                            | `cargo test --locked -p oxigraph --test sparql_negotiated_update`                                                              | `cargo test --locked -p oxigraph --test transaction_capabilities --test rocksdb_writer_serialization`                                                                 | `cargo test --locked -p oxigraph --features http-client,rdf-12 --test sparql_update_cancellation --test sparql_egress_policy --test transactional_dataset` |
| G1.6  | `lib/oxigraph/tests/sparql_effective_capabilities.rs` plus protected `cli/src/service_description/tests.rs` | `cargo test --locked -p oxigraph --features http-client-native-tls,rdf-12 --test sparql_effective_capabilities` (`public=4`)   | Separate bounded feature-active CLI service, dependency-qualified compatibility-canary, and RDF 1.2 version stages (`service=17`, `compatibility=1`, `independent=1`) | `cargo test --locked -p oxigraph --features http-client,rdf-12 --test sparql_egress_policy` (`regression=12`)                                              |
| G1.7  | `lib/oxigraph/benches/transactional_write.rs` plus the G1 regression manifest                               | Frozen target: `cargo bench --locked -p oxigraph --bench transactional_write`; the attested execution owner is not implemented | Frozen qualification control                                                                                                                                          | Frozen qualification regression control                                                                                                                    |

Engineering task contracts live below
`tools/engineering-harness/tasks/g1/<slug>/contract.json` and bind the
baseline commit, evaluator commit, mutable/blocked paths, features, targets,
ordered stage-specific commands, time/output/resource ceilings, and success
criteria. G1.6 has seven ordered stages: format, build, public, service,
compatibility, independent, and regression; its five counted stages require
exactly 4/17/1/1/12 passing results.
The G1.1-G1.6 evaluator files and G1.2-G1.6 task contracts are implemented;
G1.4a-G1.4b are also evaluator-separated, implemented, and directly accepted.
The exact ordered registry through G1.6, including G1.4a-G1.4b, is implemented. Compatibility path
constants are aliases of derived registry paths, while named wrappers delegate
to the same generic task-ID API rather than registering a second path. Direct
candidate acceptance is current through G1.6, including G1.4a-G1.4b. G1.5 covers remote egress, G1.5b covers
cancellation for update-owned transactions, and G1.5c covers negotiated
generic admission without changing the caller-owned rollback boundary. G1.6
derives deterministic configured-and-compiled disclosure from those effective
runtime capabilities without DNS or network health probes.

Implementation order is fixed: accept the version/authority policy; land the
green G1.1 reference oracle and the separate red G1.2 evaluator-only commit;
create the separate engineering package from the `latest` dist-tags for `metaharness`,
`@metaharness/harness`, `@metaharness/router`, `@metaharness/darwin`, and
`@metaharness/avo`, with an exact integrity-bound lock and lifecycle scripts
disabled; add native Codex and Claude adapters plus doctor, sandbox,
cancellation, and path tests; then add Router, persistent workers, critique,
verifier-directed repair, cross-vendor review, receipts, and one end-to-end
G1.2 run. Add `@ruvector/ruvllm` or `agenticow` only when a tested local
embedding or bounded copy-on-write path actually consumes it. Add later G1
tasks only as their direct evaluators land. GEPA waits for five discriminating
training tasks plus five sealed holdouts; AVO is limited to an eligible
hard-tail task.

Factory intake first runs disposable `claude-code` and `codex` diagnostics and
captures each generated manifest, CLI help, and test result. Do not register a
generated MCP declaration whose command is absent from that generated CLI or
lacks a direct doctor/invocation test. Router cold start uses five valid paired
Codex/Claude outcomes per role and task class against identical frozen
contracts; preparation failures do not train it. Thereafter, recalibrate at
least every fifth admitted task and whenever model, harness, or evaluator
versions change.

The engineering runtime is complete only when a real `HarnessKernel` and
`AlgorithmRouter`, persistent native worker pools, authority/path/tool/network
gates, bounded critique, cross-vendor review, verifier-directed repair,
per-host retry/circuit breakers, cancellation and wall-time enforcement,
post-verifier Router memory, and exact digest-bound candidate receipts all have
direct tests. Completion also requires one end-to-end G1 execution with both
native vendors represented and no replacement or weakening of the existing
semantic receipts. Installed packages, factory output, mocks, scores, and
synthetic Darwin runs are prerequisites or diagnostics, not completion.

### G2 — govern durable commits

| Task                                                  | Depends on                                                                            | Size | Exit gate                                                                                                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G2.1 Transactional namespace registry                 | G1.3-G1.4; evaluator freeze after `HARNESS-REGISTRY` and `HARNESS-REJECTION-EVIDENCE` |    M | Namespace changes commit/rollback with data without affecting dataset equality                                                                                                                                           |
| G2.2 Normalized semantic change set                   | G1.1, G2.1                                                                            |    L | Quad, create, clear, drop, and namespace effects remain distinct; large clear/drop need not expand synchronously                                                                                                         |
| G2.3a Durable outcomes and atomic receipts            | G1.3-G1.4, G2.2                                                                       |    L | Durable key reservation, commit ID, primary state, and receipt commit atomically; lost-response/reopen lookup proves committed, durably absent, or indeterminate without replay                                          |
| G2.3b Authoritative transaction outbox                | G2.3a                                                                                 |    L | Receipt and ordered semantic events share the primary commit; at-least-once replay and deduplication have no crash gaps                                                                                                  |
| G2.3c Outbox retention, leases, and governance health | G2.3b                                                                                 |    L | Expiry, slow consumers, backpressure, compaction, backup interaction, and minimal governance-health fixtures fail closed without unbounded work                                                                          |
| G2.4a Full staged-view SHACL commit gate              | G1.4, G2.3c                                                                           |    L | Concurrent-invalid outcomes cannot both commit over the complete selected graph contents/topology                                                                                                                        |
| G2.4b SHACL failure and receipt closure               | G2.4a                                                                                 |    M | Cancellation, timeout, limit, processor failure, mutable shapes, and bounded receipt evidence reject atomically                                                                                                          |
| G2.5 Metrics, readiness, circuit breakers             | G2.3c                                                                                 |    M | Bounded-label metrics and storage/outbox/cancellation health pass; one canonical zero-or-more contributor inventory accepts empty state and rejects unknown, duplicate, missing-required, or cursor-invalid contributors |
| G2.6 Backup receipt and creation                      | G2.3c, G2.5                                                                           |    M | Completed receipt binds store/schema/commit/sequence, authoritative outbox, canonical contributor inventory, files, and checksums; interrupted or incoherent contributions fail closed                                   |
| G2.7 Restore verification and drills                  | G2.6                                                                                  |    M | Fresh-directory restore validates topology/namespaces/outbox and every declared contributor, rejects identity/cursor drift, and records baselined RPO/RTO                                                                |

The native feed is authoritative and at-least-once. Consumers deduplicate by
`(commit_id, event_index)`. Its records carry schema version and checksum; its
contract defines retention, cursor leases/expiry, slow-consumer backpressure,
and compaction/backup interaction. Restart, lag, cursor expiration, retention
advance, and clear/drop without synchronous expansion must not create gaps.
In-process listeners consume the same feed, and `ProvenAbsent` requires a
durable transaction-key reservation or tombstone. G2.3c exposes only the
minimal governance-health input consumed by G2.5; it does not pre-claim
operational readiness.
[Jena RDF Patch](https://jena.apache.org/documentation/rdf-patch/) is an optional
export adapter, not the storage format. A checkpoint-plus-manifest recovery
workflow precedes RocksDB BackupEngine complexity. G2.5-G2.7 share a canonical
zero-or-more derived-state contributor hook: empty is valid, a test-only fake
proves the nonempty path, and unknown, duplicate, missing-required, or
cursor-mismatched entries fail closed. The backup receipt binds the store UUID,
schema version, source commit ID, RocksDB sequence, authoritative-outbox cursor,
canonical contributor inventory, file inventory/checksums, and a completion
marker. G2 does not depend on G3.0; later providers plug into the hook.

SHACL validation is network-free, bounded, and fail-closed. External policy
shapes are version-pinned at begin. If a transaction mutates its shapes graph,
the validator uses the resulting staged shapes and forces full validation;
incremental validation is only a later differential optimization.

### G3 — optimize after correctness

| Task                                            | Depends on                                                                                                                          | Size | Exit gate                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G3.0 Shared rebuildable derived-index lifecycle | G2.3c, G2.5-G2.7                                                                                                                    |   XL | Versioned provider/schema identity, source/applied commits, checksummed crash-safe generations, bounded rebuild/delta, atomic activation, cancellation/resource ceilings, lag/readiness, backup contribution, restore reconciliation, and fake-provider crash/conformance matrix |
| G3.1 Statistics provider and feedback           | G2.3c, G2.5-G2.7                                                                                                                    |   XL | Exact graph/predicate counts, bounded sketches/top-K, freshness commit, estimated/actual rows and q-error                                                                                                                                                                        |
| G3.2 Bounded join planning                      | G3.1                                                                                                                                |    L | Dynamic programming for small BGPs and greedy fallback improve the frozen corpus without semantic change                                                                                                                                                                         |
| G3.3 Text provider                              | G3.0                                                                                                                                |   XL | Tantivy candidate verification plus provider-specific strict/eventual equivalence and resource receipts pass on the shared lifecycle                                                                                                                                             |
| G3.4 Spatial provider                           | G3.0                                                                                                                                | L/XL | Per-CRS envelope candidates refine through exact `spargeo` and pass provider-specific equivalence/resource receipts on the shared lifecycle                                                                                                                                      |
| G3.5 Federation planner                         | G1.5, G3.1-G3.2 for embedded/research; additionally G1.6 for advertisement; additionally G4.1-G4.2 for server exposure or promotion |   XL | Catalog/source selection/bound joins obey per-endpoint budgets and `SERVICE SILENT` semantics                                                                                                                                                                                    |

The current optimizer's fixed large cardinalities and constant join-key
selectivity make statistics the highest-leverage performance seam after P0.
Start with bounded dynamic programming and telemetry; do not begin with a full
Cascades framework or mid-query adaptive replanning. RDF4J 6's sketch-based
planning work is useful SOTA direction but is still described as experimental
in its [6.0 release notes](https://rdf4j.org/release-notes/6.0.0/).

Text and spatial indexes are rebuildable outbox consumers, not participants in
the primary commit. For text, bind the applied primary commit in the
[Tantivy](https://docs.rs/tantivy/latest/tantivy/indexer/struct.IndexWriter.html)
commit payload and verify stale-deletion candidates against primary state.
Strict queries either wait until `applied_commit >= required_commit`, use an
authoritative fallback scan, or return a typed `IndexNotFresh`; they never
silently omit additions missing from a lagging index. Eventual results are
explicitly opt-in. For spatial, start with immutable `rstar` generations plus a
bounded delta overlay and refine every candidate with the existing exact
predicates.

Incremental SHACL, higher-concurrency RocksDB transactions, adaptive execution,
custom persistent spatial trees, transparent implicit federation, and
cross-endpoint transactional federation are later hypotheses. Explicit
`SERVICE`-aware source planning remains G3.5. Full staged-view validation and
heuristic query fallback remain their differential oracles.

### G4 — explicit linked-data platform decisions

These tasks are independently promotable only after their stated dependencies
and frozen evaluators close. A protocol or comparison implementation never
widens core RDF semantics implicitly.

| Task                                           | Depends on                             |        Size | Exit gate                                                                                                                                                               |
| ---------------------------------------------- | -------------------------------------- | ----------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G4.1 Service identity and authorization        | G1.5-G1.6                              |          XL | Principal propagation plus coarse endpoint/whole-operation and direct Graph Store authorization fail closed without leaking protected data                              |
| G4.2 Workload admission and operator resources | G1.4-G1.5; G4.1 for principal quotas   |          XL | Queue, deadline, memory/row/byte/concurrency budgets, cancellation, fairness, and bounded telemetry survive overload without weakening transaction or egress guarantees |
| G4.3 Safe storage schema upgrades              | G2.7                                   |           L | Version discovery, preflight, backup receipt, resumable shadow copy, source-preserving cutover, crash matrix, and old/new binary compatibility fail closed              |
| G4.4 RDF4J REST interoperability               | G2.3c, G4.1-G4.2, G4.5                 |          XL | A versioned endpoint profile passes an exact RDF4J client/HTTP corpus for statements, namespaces, query/update, contexts, transactions, errors, and content negotiation |
| G4.5 Leased remote HTTP transactions           | G2.3a, G4.1-G4.2                       |          XL | Opaque leases, expiry, idempotent terminal operations, disconnect/crash cleanup, and bounded ownership prevent orphaned writers and ambiguous replay                    |
| G4.6 Multi-repository lifecycle                | G2.7, G4.1-G4.3                        |          XL | Create/open/close/delete/backup/restore operations are authorized, resource-isolated, receipt-bound, and safe under concurrent administration                           |
| G4.7 Incremental entailment projections        | G2.3c, G2.7                            |          XL | Insert/delete/clear/drop truth maintenance differentially matches full recomputation; unsupported recursion/deletion shapes rebuild or fail typed                       |
| G4.8 Analytical and WCOJ research path         | G3.2; G4.2 for server/`Auto` promotion | Research/XL | A separate optional executor beats frozen cyclic workloads within resource ceilings while matching the ordinary evaluator exactly and preserving its fallback           |

## Evaluator DAG

The harness delegates rather than duplicates.

### Patched-candidate verification transaction

Every engineering candidate and repair uses this exact order:

1. restore an isolated verifier worktree to the task's pinned red baseline;
2. overlay the frozen evaluator-only commit;
3. apply the admitted candidate patch;
4. rebuild all declared crates, feature combinations, native helpers,
   generated bindings, and web artifacts inside that patched workspace;
5. classify build failure as an authoritative repair issue;
6. run the task's public, independent, and impacted-regression commands against
   those fresh artifacts; and
7. bind commands, exits, tool versions, and relevant artifact digests into the
   candidate receipt.

The engineering harness must have a direct control-plane test that fails if a
build occurs before patch application or an evaluator reads an artifact built
from a different tree. Ordinary cycles stop after affected fast product gates;
the complete Agentic-QE, Jena, mutation, and semantic-qualification sequence
runs only for a promotion candidate.

### Fast structural and persistence gate

```bash
cargo fmt --all -- --check
git diff --check
cargo check --locked --workspace --all-targets
cargo test --locked -p oxigraph --test transactional_dataset
cargo test --locked -p oxigraph --test update_atomicity
cargo test --locked -p spareval --test dataset_topology
cargo test --locked -p oxigraph --test dataset_topology
cargo test --locked -p oxigraph-cli service_description::tests
cargo test --locked -p oxigraph-cli parallel_load_
cargo test --locked -p oxigraph-cli --all-targets --no-default-features
(cd lib/spareval && cargo clippy --all-targets -- -D warnings -D clippy::all)
(cd lib/oxigraph && cargo clippy --all-targets --features rdf-12 -- -D warnings -D clippy::all)
(cd cli && cargo clippy --all-targets -- -D warnings -D clippy::all)
(cd cli && cargo clippy --all-targets --no-default-features -- -D warnings -D clippy::all)
```

Run the applicable changed-target Clippy commands exactly as above, mirroring
the working directories and warning policy in `.github/workflows/tests.yml`.

### Profile and evidence gate

1. Revalidate G0.1 by initializing the four registered test-suite submodules at
   their exact recorded revisions in every fresh verifier before treating
   source verification as evidence.
2. Reuse the G0.4-G0.5 definitions from `253a2b34`: run
   `(cd tools/agentic-qe && npm ci --ignore-scripts && npm run test:adapter)`
   and `(cd tools/agentic-qe && npm run test:persistence-write)`. Any drift from
   the reviewed 144/129/34 inventories fails closed.
3. Reuse G0.2's locked runner from `46ef17fc` and G0.3's reviewed profile from
   `22a8033e`. Before promotion, run
   `bash tools/jena-parity/scripts/run.sh` twice and require byte-identical
   receipts for the same protected subject; drift requires another separately
   reviewed lock operation, never an automatic refresh.
4. G0.6 ran `node --test tools/mutation/*.test.mjs`, acquired registry-latest
   `cargo-mutants` 27.1.0 with `cargo install --locked cargo-mutants`, verified
   executable/version agreement, and published run
   `731e6467-2cab-4260-8d15-b34e4ebc8ed6` through
   `node tools/mutation/oxdatalog.mjs --jobs 2`. Repeat this sequence after any
   protected OxDatalog drift. Keep ADR-0013's scope explicit; P0 needs a
   separate reviewed mutation or deterministic failure-injection competence
   profile.
5. G0.7 reconciled the machine-readable ledger and froze root README plus every
   protected ADR, plan, and research document. MetaHarness hashes these inputs,
   so editing claims after qualification invalidates the receipt; editing them
   before qualification intentionally changes the candidate snapshot.
6. Only after every lower receipt is current, run
   `(cd tools/metaharness && npm ci --ignore-scripts && npm test && npm run qualify)`; `qualify`
   includes the MetaHarness independent verifier.
7. Then run `(cd tools/evidence && npm test && npm run verify:full)`.
8. Dream Machine may inspect a secondary explicit ledger only after absence and
   read errors fail distinctly. Its upstream Actions witness currently hashes
   and then modifies the report; require immutable finalized bytes and a
   separately stored witness with a successful round trip. A checksum never
   replaces a native receipt.

Do not run the Agentic 47-command aggregate and the MetaHarness 41-command
semantic gate in the same candidate cycle unless the six additional commands
are explicitly required; otherwise the expensive evidence is duplicated.

## Parallelization and promotion

Use at most three active Ruflo lanes per wave:

- **Lane A — conformance:** state model, concurrency, failure injection;
- **Lane B — egress/performance:** security fixtures, baselines, statistics;
- **Lane C — evidence/ADR:** locks, exact inventories, claims, independent
  review.

One integration owner freezes G1.3's error vocabulary, resolves shared-file
edits, and promotes the single candidate. Agentic/Jena/mutation/qualification
publication is sequential. Each candidate produces:

- hypothesis and baseline commit;
- exact command/ID inventory and environment;
- parent and candidate receipts;
- critic and reward-hack dispositions;
- performance and resource comparison;
- migration/rollback note;
- `ACCEPT`, `REJECT`, or `INCONCLUSIVE`; and
- a human promotion decision.

Darwin remains off until the product slice and baseline exist. The initial
write-layer plan is deterministic, at most two generations by two children,
one lineage, and no `--confirm` without operator review. Its mutable surface is
the seven ADR-0004 policy fields only.

## Benchmark and optimization contract

Retain the existing BSBM regressions and add reviewed, reproducible subsets of:

- [WatDiv](https://dsg-uwaterloo.github.io/watdiv/) for query-shape and
  selectivity diversity;
- [LDBC Semantic Publishing Benchmark](https://ldbcouncil.org/benchmarks/spb/)
  for mixed query/update behavior;
- [FedShop](https://github.com/GDD-Nantes/FedShop) for controlled federation;
  and
- a Geographica-derived exact-result spatial corpus.

Record cold/warm p50/p95/p99 latency, throughput, peak RSS, intermediate rows,
planning time, estimate q-error, cancellation latency, remote requests/bytes,
update overhead, index lag, and rebuild time. Pin generator/repository
revisions, licenses, dataset scales, query IDs, hardware, durability mode,
cache state, repetitions, and confidence/noise treatment. Include 1/4/16
writers with concurrent readers, plus nightly long-run traces beyond the
10,000-trace CI floor. Freeze numeric p50/p95 q-error and intermediate-row
gates, per-query tail rules, cancellation latency, outbox lag, index
freshness/rebuild, backup RPO, and restore RTO after baselining. Initial
hypotheses may use geomean query gain of 20%, median intermediate-row reduction
of 50%, and a 5% per-query p95 latency-regression ceiling. Apply planner
overhead by baseline regime: at most 10 ms for queries below 200 ms, and at
most 5% of execution time for queries at or above 200 ms. These are candidate
thresholds—not evidence until baselined and frozen.

Correctness is non-negotiable. A faster candidate with one semantic,
topology, isolation, cancellation, security, receipt, or recovery regression
is rejected.

## Risks and controls

| Risk                                                 | Control                                                                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Stable snapshot is mislabeled snapshot isolation     | Concurrent serialization oracle plus dimensioned capabilities                                              |
| Writer lock hides an unacceptable bottleneck         | Baseline first; only then evaluate OCC/TransactionDB as a separate ADR/hypothesis                          |
| Evidence lock is self-approved                       | Dedicated reviewed refresh; Dream/Darwin cannot edit it                                                    |
| Exact test inventory drifts                          | Required counts and IDs fail closed; add a narrow persistence profile                                      |
| Harness optimizes its own score                      | Product artifact first, immutable evaluators, independent critic, proportionality cap                      |
| Prompt or config injects shell/publication authority | Dream activation blocked until literal argv, protected paths, local-only, and provider policy are enforced |
| Outbox duplicates or skips                           | Atomic receipt/outbox, at-least-once cursor, idempotent consumer key, crash matrix                         |
| Incremental SHACL misses an affected node            | Full staged-view oracle first; fall back on shape change; continuous sampled differential                  |
| Derived index changes semantics                      | Exact primary verification, explicit lag, rebuild, correctness fallback                                    |
| Planner overfits one benchmark                       | Multiple structural workloads, per-query regressions, q-error and resource telemetry                       |
| Volatile Ruflo state is mistaken for product config  | Keep runtime state untracked; commit only reviewed plans, ADRs, and future thin adapters                   |

## Ruflo and research ledger

The design was coordinated by Ruflo swarm
`swarm-1787600160271-7e42i2`, topology `hierarchical-mesh`, three specialized
research lanes, human-only promotion, and no OpenRouter provider route.

| Track                                      | Ruflo task                                                                                                                                          | Result                                                                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dream Machine source/install/fit           | `task-1787600167777-nwxrh1`                                                                                                                         | 0.1.1 local CLI useful; unattended routine blocked                                                                                                       |
| Repository harness and ADR drift           | `task-1787600167739-xfkq2y`                                                                                                                         | Jena lock, runner lock, Agentic counts, mutation freshness, and evidence prose require repair                                                            |
| SOTA RDF storage/optimization              | `task-1787600167815-d5ki1t`                                                                                                                         | Correctness first; serialize writers, then receipts/SHACL/ops/statistics/indexes/federation                                                              |
| Dream installation proof                   | `task-1787600167854-42vvou`                                                                                                                         | User-scoped 0.1.1, deterministic compile, no schedule/publication/provider execution                                                                     |
| MetaHarness assessment                     | `task-1787600167962-6qk4jb`                                                                                                                         | Non-authoritative local observation: genome ready, score 71, point-in-time OIA clean/generic, Darwin dry-run, synthetic PASS                             |
| G1.7 portable ordering/replay audit        | `task-1787778499571-d8wwyk`                                                                                                                         | Read-only review clean; focused ordering and replay suite 51/51                                                                                          |
| G1.7 schema/assurance-boundary audit       | `task-1787778501119-1krv3k`                                                                                                                         | Read-only review clean; focused structural/sealed/CLI suite 35/35                                                                                        |
| G1.7 claims/documentation audit            | `task-1787780431763-1cqm80`                                                                                                                         | Read-only review completed for the earlier v1/v2 boundary; the follow-on contract-v2/compatibility-v3 native-owner wording is reconciled in this slice   |
| G1.7 v4 core / integration / legacy repair | `task-1787869267480-t4j9c8` / `task-1787872420656-oeaphy` / `task-1787874829121-tag4ud`                                                             | Complete historical v4 policy/statistics and live gate; subsequent dispatch preserves Darwin-free v1/v3/v4 replay; no samples or promotion authority     |
| G1.7 two-phase owner programme             | `task-1787875911749-oh5io9` / `task-1787875912935-c2bi69` / `task-1787875914136-aw7onh` / `task-1787875915280-otfrw9`                               | V6 protocol/statistics implementation complete; human approvals, sealed control owner/receipt/replay, final approval, and qualification owner remain     |
| G1.7 prerequisite / legacy / governance    | `task-1787875916428-3vb8m7` / `task-1787875917561-6s54e3` / `task-1787875918734-1sjl6c` / `task-1787882542649-y8dttl` / `task-1787885074292-neafw8` | Exact G1.4b binding, Darwin-free legacy dispatch, v6 statistics, and pre-merge v11 governance synchronization complete at the pure-contract boundary     |
| Upstream `ec68e3dd` reconciliation         | `task-1787883108007-gik9bz`                                                                                                                         | Complete at audited merge `e9d2db1b`; exact-tree Rust/Python/workflow/harness audit passes; ADR-0014 selected-missing `POST=404` retained                |
| G1.7 post-upstream pure reseal             | `task-1787888366495-gzxbhe`                                                                                                                         | Complete in `d1e18c6e`; exact subject/lock/evaluator/proposed-authorization identities are sealed at the pure boundary, with no live execution authority |
| G1.7 pure owner/receipt-candidate replay   | `task-1787892615000-rdwz7q`                                                                                                                         | Complete in `45121da9`; focused 45/45 and full 444/0/2 pass; result is candidate-only, non-eligible, binding-null, and non-authoritative                 |
| G1.7 physical control envelope             | `task-1787896401667-xookiy`                                                                                                                         | Pending: write-once/receipt-last/fsync/mode/nlink/inventory proof and the only prospective layer allowed to derive the final-decision binding            |

The three G1.7 reviews ran under reviewer swarm
`swarm-1787778496656-aq8q1c`. They are adversarial control review, not product
qualification: ordering, schema, and claim checks cannot substitute for current
clean-subject owner evidence, benchmark/noise evidence, or the human promotion
decision.

Repository-local memory remains supplementary to the committed plan. The
sql.js wrapper correctly refused an unsafe whole-image write while a native WAL
connection was active. The managed native Ruflo CLI then stored and exactly
retrieved the consolidated result at
`research/oxigraph-2026-08-24-evolution-harness-synthesis` in the explicit
repository database. The managed CLI also stored and exactly retrieved the
execution graph at
`goap-plans/oxigraph-linked-data-evolution-2026-08-24` and the SPARC state at
`sparc-phases/oxigraph-linked-data-evolution-harness-2026-08-24`. No plan gate
depends on a lossy memory fallback.

The initial ADR breakout used Ruflo swarm `swarm-1787603675053-t6b9y7` with
three read-only architecture lanes and one root integration writer. Its 26
original G0.1-G3.5 items were materialized as Ruflo task rows on 2026-08-24;
seven separate governance rows track drafting, integration, ledger proof, QA,
and commit without changing programme status.

On 2026-08-25 the programme was expanded to 39 stable executable identifiers:
G1.5b-G1.5c, explicit G2.3a-G2.3c and G2.4a-G2.4b leaves, and G4.1-G4.8. The
original G2.3 and G2.4 rows remain pending roll-ups; they complete only after
their child rows and are not independent implementation leaves. The current
audit pointers needed for the expanded and corrected control edges are:

On 2026-08-27 G3.0 raised the total to 40 stable executable identifiers. The
recovery audit then raised it to 41 by adding G1.4a as the explicit built-in
Store terminal-outcome prerequisite of G1.7. G3.0 owns the shared derived-index
lifecycle between G2.3c/G2.5-G2.7 and the G3.3/G3.4 providers. Support and
roll-up rows remain outside that count. G1.4b raised the total to 42 on
2026-08-28 by making the outcome phase-fault prerequisite executable.

| Plan IDs                                                                | Ruflo task rows                                                                                                                                     |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1.4a / G1.4b / corrected replacement G1.7                              | `task-1787855156849-ya7t6b` / `task-1787869201628-bwe6b0` / `task-1787871483413-ki34q2`                                                             |
| G1.5c / G1.6 / `HARNESS-REGISTRY` / `HARNESS-REJECTION-EVIDENCE` / G2.1 | `task-1787667172994-ru8mm1` / `task-1787603736309-5dnsls` / `task-1787676052834-q1rbfr` / `task-1787740750614-4bv1fw` / `task-1787603736400-274ola` |
| G2.3a / G2.3b / G2.3c                                                   | `task-1787670631130-9jlo3h` / `task-1787670631321-dewzgm` / `task-1787670631517-qjoyw1`                                                             |
| G2.4a / G2.4b                                                           | `task-1787670631682-97ibi4` / `task-1787670631837-w5ac24`                                                                                           |
| G2.5 / G2.6 / G2.7 / G3.0                                               | `task-1787851231441-1gdfzd` / `task-1787851232211-6fiarr` / `task-1787851233022-antw51` / `task-1787851230690-xr6ls9`                               |
| G3.3 / G3.4 / G3.5                                                      | `task-1787851233862-4l1tii` / `task-1787851234657-p0yfbo` / `task-1787851235446-7vlbgt`                                                             |
| G4.1 / G4.2 / G4.3                                                      | `task-1787670631989-m5vxqk` / `task-1787728711461-3isex6` / `task-1787670632284-k0cti5`                                                             |
| G4.4 / G4.5                                                             | `task-1787670632568-gk92vo` / `task-1787670632421-dkucm8`                                                                                           |
| G4.6 / G4.7 / G4.8                                                      | `task-1787728710646-enu8i1` / `task-1787670632864-10hfsk` / `task-1787728711087-ibcg53`                                                             |

The original exact map remains at
`task-plans/linked-data-store-g0-g3-2026-08-24`, and the v2-v13 maps remain
historical audit records. The current v14 map is stored and exactly read back
through the managed Ruflo interface at
`task-plans/linked-data-store-g0-g4-2026-08-28-v14`. It preserves all 42 stable
plan identifiers, records G1.4a-G1.4b, corrected replacement G1.7, G3.0, and
the earlier replacement rows, and includes the
non-product `HARNESS-REGISTRY`, rejection-evidence, and
`AGENTIC-SCHEMA-V5-REFRESH` controls. It additionally records the G1.7
two-phase owner/governance, v6 statistics, completed upstream merge, completed
post-merge pure reseal, completed pure owner/receipt-candidate replay, pending
physical control-envelope work, and governance support rows without changing
the stable count.
Superseded pending rows are cancelled but retained as runtime history.

The source-grounded current native `task_create` schema persists descriptions,
priority, assignment, and tags in Ruflo-managed runtime state, but exposes no
dependency argument. This plan deliberately makes no claim about Ruflo's
changeable backing-file implementation. Rows were therefore created
sequentially and dependencies are encoded as `depends:<plan-id>` tags and in
each description.
Those task IDs and descriptions are audit pointers; cancelled and superseded
historical rows remain part of runtime history and can be stale. Stable
G-identifiers, this committed GOAP graph, and the exactly read-back v14 Ruflo
task map remain authoritative. Ruflo's separate
domain task entity models dependencies, but this plan does not claim that the
current MCP task surface enforces them.

## QA score

This plan scores **98/100** against the programme rubric:

| Dimension                              | Score | Evidence                                                                                                                  |
| -------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------- |
| Source and implementation grounding    | 20/20 | Local transaction/optimizer/harness source, live Dream source/npm, Brain implementation sources, official comparison docs |
| Scope and architecture                 | 20/20 | P0-P3 planned work, explicit G4 decisions, ten DDD contexts                                                               |
| Dependency and parallelization clarity | 15/15 | G0-G4 graph, three lanes, sequential publication gates                                                                    |
| Verifiable acceptance                  | 19/20 | Exact inventories, model/concurrency/crash/security/performance gates; thresholds await baseline freeze                   |
| Security and promotion control         | 15/15 | Native providers, local-only, protected oracles, isolated worktrees, human promotion                                      |
| Operational realism                    |  9/10 | Current drift and degraded modes explicit; production replacement adapter and recovery baseline remain open               |

The withheld points are real open evidence, not documentation debt. No
candidate is promotable until G0 closes and its affected native receipts are
current.
