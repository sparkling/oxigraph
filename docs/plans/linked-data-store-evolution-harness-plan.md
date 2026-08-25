# Linked-data-store implementation and evolution harness plan

- Status: active execution plan; unattended Dream Machine activation blocked
- Date: 2026-08-24
- Updated: 2026-08-25
- Repository: `oxigraph/oxigraph` clone maintained by this fork
- Upstream baseline: `oxigraph/oxigraph`
  `8dcfb6b66cbb077bb2406379abb280d2471970d7`
- Observed fork source before this documentation slice:
  `38ad365d46890d62b1b2db9c2eff493c464c4542`
- Semantic Builder handover reviewed against:
  `e1097e482476030f012da538151fd967614fb619`
- Product plan:
  [persistence writes and linked-data-store parity](persistence-write-and-linked-data-parity-plan.md)
- Harness decision:
  [ADR-0017](../adr/0017-repository-evolution-and-evidence-promotion-harness.md)
- Write-interface decision:
  [ADR-0016](../adr/0016-backend-neutral-transactional-writes.md)
- Outstanding capability decisions:
  [ADR-0018 through ADR-0033](../adr/README.md)

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
backend admission and G1.6 runtime-derived service claims remain open.
G0.1-G0.5 are complete for their exact source-bound scopes; G0.6 mutation,
G0.7 protected-evidence freeze, and G1.7 promotion remain open.
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

| Surface | Current evidence | Disposition |
|---|---|---|
| Backend-neutral write seam | Implemented and verified in `1da47285` | Preserve the minimal GAT traits; add optional capabilities through extension traits |
| Memory writers | Serialized by the storage transaction lock | Use as the first serial reference behavior |
| RocksDB writers | G1.2 freezes the formerly red lost-update/write-skew baseline; G1.4 now proves a per-instance gate acquired before snapshot creation, held through terminal state, and bounded while queued | Advertise only the proven serialized-writer profile; evaluate OCC/TransactionDB only if G1.7 measurements justify a separate hypothesis |
| Built-in remote egress and owned updates | G1.5's frozen 12/8/13 evaluator proves one deny-by-default policy across `SERVICE`, `LOAD`, and nested document retrieval; G1.5b's 6/6/12 profile proves typed cancellation across built-in admission, local mutation, and the owned pre-commit boundary | Advertise only those proven profiles; complete negotiated generic admission and runtime-derived claims before accepting ADR-0019 |
| Jena differential | G0.3 refreshed the reviewed protected profile in `22a8033e`; two complete 76-scenario/198-assertion runs produced byte-identical artifacts for that exact subject | Scoped task complete; later protected-source drift is reconciled by G0.7 and promoted only through G1.7 |
| Jena runner lock | G0.2 restored the reviewed `runner/Cargo.lock` strategy in `46ef17fc`, so the pinned runner executes with `--locked` from a clean checkout | Scoped task complete; retain the lock as protected evidence |
| Agentic-QE CLI inventory | G0.4-G0.5 in `253a2b34` bind 144/144 default, 129/129 no-default, and 34/34 `persistence-write` tests | Scoped tasks complete; later count or ID drift still fails closed |
| Pinned source checkouts | G0.1 initialized and verified the RDF Canon, JSON-LD API, JSON-LD Streaming, and N3 registered revisions | Scoped task complete; every fresh verifier must still initialize those exact registrations rather than substitute parent HEAD |
| Mutation receipt | Source-bound to the pre-write-interface library tree | Historical for its sealed OxDatalog subject; verify the harness and regenerate that exact scope before full qualification, without claiming persistence mutation coverage |
| MetaHarness | 13/13 MetaHarness tests and synthetic qualification pass | Full qualification remains blocked by G0.6 mutation evidence and G0.7 protected-evidence reconciliation/freeze; G1.7 promotion is separate |
| Engineering MetaHarness | Separate local-only package, native worker adapters, Router history, sealed reconstruction, one-session sandbox, and digest receipts are implemented; G1.2-G1.5b have source-bound accepted candidates | Preserve separation from semantic qualification; each later task still needs its own direct evaluator and exact receipt |
| Generic MetaHarness read layer | Genome ready, risk 0.21, score 71/100; point-in-time OIA dry-run reported clean | Advisory only; OIA identifies an unknown generic harness, produced no durable receipt, and cannot promote code |
| Dream Machine | User-scoped 0.1.1 CLI installed; deterministic compile; missing-ledger fallback observed | Local utility only; the fallback is not ledger proof, and there is no schedule, committed generated prompt, repository config, or publication |

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

| Tool or practice | Use now | Activation boundary |
|---|---|---|
| Ruflo hierarchical-mesh swarm | Three independent research/review lanes, persistent task dependencies, anti-drift state | Task completion is not semantic evidence |
| Ruflo goals and memory | GOAP state, exact research findings, replayable decisions | Repository facts stay repository-local; active-WAL retrieval failures do not block delivery |
| Brain | Source-ground Darwin, Ruflo, OIA, and Dream Machine claims | Local source/tests remain authoritative for Oxigraph |
| MetaHarness genome/score/OIA | Readiness and risk diagnostics | Generic identity and scores are advisory |
| Existing `tools/metaharness` adapter | Policy-only qualification against immutable local oracles | Synthetic mode never upgrades to semantic proof; do not make it a worker host |
| `tools/engineering-harness` | Native-worker routing, isolated builds/repairs, focused evaluation, and candidate receipts | Implemented for G1.2-G1.5b; still no semantic or promotion authority |
| Darwin | Deterministic, bounded policy mutation after a product slice exists | `--confirm` requires operator review; never mutate product or oracle inputs |
| Dream Machine | Version/help, stdout-only config inspection, deterministic compile in temporary storage, ledger validation vocabulary | ADR-0017 prerequisites 1-7 must be current and gate 8 must authorize the exact run before a runner/config is committed or scheduled |

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

| Context | Owns | Must not own |
|---|---|---|
| Dataset query | `QueryableDataset`, snapshots, algebra reads | Mutation, commit, or operational policy |
| Transactional mutation | `TransactionalDataset`, `WritableDataset`, graph topology, transaction states | Bulk-loader batching, backup, or secondary-index implementation |
| Bulk ingest | Large files, batching, per-file/cross-file atomicity | Interactive transaction guarantees it cannot meet |
| Commit governance | Capability negotiation, writer gate/conflicts, change-set orchestration, receipt, outbox | Validation policy/semantics, query planning, or index-specific types |
| Egress and cancellation | `SERVICE`, `LOAD`, JSON-LD fetch policy, deadlines, byte budgets, typed failures | Commit replay or authorization decisions |
| Semantic validation | Validation policy and a pinned SHACL profile over the staged view | Network access, writer-gate ownership, or independent commit |
| Derived state | Statistics, text, and spatial providers, cursors, rebuilds | Primary truth; every optimization retains an exact fallback |
| Federation | Endpoint catalog, source selection, bound joins, per-endpoint budgets | Egress-policy bypass or remote correctness assumptions |
| Operations | Metrics, readiness, backup, restore, compaction, recovery receipts | RDF/query/user payloads in default telemetry |
| Evidence and evolution | Frozen evaluators, receipts, policy variants, human promotion | Product semantics or autonomous publication |

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

| Plan work | Owning decision | Decision status |
|---|---|---|
| G0.1 source registration | [ADR-0017](../adr/0017-repository-evolution-and-evidence-promotion-harness.md) | Implemented programme control |
| G0.2-G0.3 Jena evidence | [ADR-0012](../adr/0012-immutable-broad-jena-harness.md) | Accepted |
| G0.4-G0.5 Agentic-QE evidence | [ADR-0005](../adr/0005-agentic-qe-integration.md) | Accepted |
| G0.6 mutation evidence | [ADR-0013](../adr/0013-mutation-competence-and-provenance.md) | Accepted |
| G0.7 evidence freeze/promotion | [ADR-0004](../adr/0004-metaharness-darwin-qualification.md), [ADR-0017](../adr/0017-repository-evolution-and-evidence-promotion-harness.md) | Accepted qualification policy; implemented engineering control |
| G1.1-G1.4 transaction truth | [ADR-0018](../adr/0018-transaction-guarantees-and-conflict-model.md) | Proposed |
| G1.5-G1.6 egress/cancellation/claims, including G1.5b-G1.5c | [ADR-0019](../adr/0019-unified-egress-cancellation-and-service-claims.md) | Proposed |
| G1.7 promotion | [ADR-0017](../adr/0017-repository-evolution-and-evidence-promotion-harness.md), [ADR-0018](../adr/0018-transaction-guarantees-and-conflict-model.md), [ADR-0019](../adr/0019-unified-egress-cancellation-and-service-claims.md) | Implemented control; product decisions Proposed |
| G2.1-G2.3c metadata/receipts/outbox | [ADR-0020](../adr/0020-transactional-metadata-receipts-and-change-delivery.md) | Proposed |
| G2.4a-G2.4b transaction-time SHACL | [ADR-0021](../adr/0021-transaction-time-shacl-validation.md) | Proposed |
| G2.5-G2.7 readiness/recovery | [ADR-0022](../adr/0022-operational-readiness-backup-and-recovery.md) | Proposed |
| G3.1-G3.2 statistics/planning | [ADR-0023](../adr/0023-statistics-and-bounded-join-planning.md) | Proposed |
| G3.3-G3.4 derived indexes | [ADR-0024](../adr/0024-rebuildable-derived-indexes.md) | Proposed |
| G3.5 explicit federation | [ADR-0025](../adr/0025-explicit-service-federation.md) | Proposed |
| G4.1 service identity/authorization | [ADR-0026](../adr/0026-service-identity-and-authorization.md) | Proposed |
| G4.2 workload/resource governance | [ADR-0027](../adr/0027-workload-admission-and-operator-resources.md) | Proposed |
| G4.3 storage schema upgrades | [ADR-0028](../adr/0028-safe-storage-schema-upgrades.md) | Proposed |
| G4.4 RDF4J REST interoperability | [ADR-0029](../adr/0029-rdf4j-rest-interoperability.md) | Proposed |
| G4.5 leased remote HTTP transactions | [ADR-0030](../adr/0030-leased-remote-http-transactions.md) | Proposed |
| G4.6 multi-repository lifecycle | [ADR-0031](../adr/0031-multi-repository-lifecycle.md) | Proposed |
| G4.7 incremental entailment | [ADR-0032](../adr/0032-incremental-entailment-projections.md) | Proposed |
| G4.8 analytical/WCOJ research | [ADR-0033](../adr/0033-analytical-wcoj-execution.md) | Proposed |

### G0 — repair and freeze evidence

Run three independent lanes, then integrate sequentially:

| Task | State | Owner lane | Depends on | Exit gate |
|---|---|---|---|---|
| G0.1 Initialize registered source submodules | Complete | Evidence | none | Source verifier saw exact registered checkout heads rather than the parent repository |
| G0.2 Restore Jena runner lock reproducibility | Complete (`46ef17fc`) | Evidence | none | Clean checkout executes the pinned `--locked` runner |
| G0.3 Review current Jena subject and refresh profile lock | Complete (`22a8033e`) | Evidence | G0.2 | Lock diff reviewed; two complete byte-identical 76/198 runs |
| G0.4 Reconcile Agentic-QE exact CLI counts/IDs | Complete (`253a2b34`) | Evidence | none | 144 default and 129 no-default inventories deliberately accepted |
| G0.5 Add `persistence-write` evidence profile | Complete (`253a2b34`) | Conformance | none | 34 exact IDs cover transactional dataset, update atomicity, topology, service claims, and failure injection |
| G0.6 Verify and regenerate OxDatalog mutation receipt | Open | Evidence | none | `node --test tools/mutation/*.test.mjs` passes; the latest registry `cargo-mutants` release is acquired without a top-level version constraint; the run has zero survivors/timeouts and reopens its exact source- and runtime-bound receipt |
| G0.7 Reconcile and freeze protected evidence documents | Open | ADR/claims | G0.1-G0.6 | Ledger, README, ADRs, plans, and research mark historical versus current receipts accurately and are frozen before qualification |

No lock, expected count, manifest, threshold, or receipt is refreshed
automatically by Dream Machine or Darwin.

### G1 — make P0 transaction claims true

| Task | Depends on | Size | Exit gate |
|---|---|---:|---|
| G1.1 State-machine reference model | none; run beside G0 | L | At least 10,000 shrinking traces/backend in CI; every failure has a seed |
| G1.2 Concurrent history oracle | G1.1 | M | Lost-update/write-skew schedules expose current behavior; zero silent anomalies across the frozen stress budget |
| G1.3 Typed request/capability/error extensions | G1.1-G1.2 | L | Effective guarantee returned; unmet minimum rejected; conflict and indeterminate outcomes typed |
| G1.4 RocksDB writer serialization | G1.2-G1.3 | M | Bounded/cancellable gate acquired before snapshot and held through commit/rollback/drop; advertised guarantee passes the 1/4/16-writer oracle while readers remain concurrent |
| G1.5 Unified remote egress | G1.3 | L | Loopback SSRF/redirect/size/timeout fixtures and remote update rollback pass |
| G1.5b Owned-update cancellation | G1.5 | M | Built-in admission, validation, mutation loops, and the final pre-commit checkpoint return typed cancellation and roll back owned state |
| G1.5c Negotiated backend admission | G1.5b | M | An additive negotiated binding carries the exact token and request through custom and Store admission without breaking the minimal write trait |
| G1.6 Runtime-derived service claims | G1.3, G1.5, G1.5b, G1.5c | M | Every advertised capability has a closed endpoint receipt |
| G1.7 Compatibility/performance and promotion gate | G0.1-G0.7, G1.1-G1.6 | M | Existing semantics and current evidence green; approved write/read budgets met |

`HARNESS-REGISTRY` is a harness-maintenance control, not a new product G task.
It follows G1.6 and replaces duplicated per-task dispatch registration with a
fail-closed static registry. G2.1's evaluator may be designed earlier, but its
contract is not frozen until that control closes. The sequencing edge is
therefore G1.6 → `HARNESS-REGISTRY` → G2.1 evaluator freeze.

Execution record on 2026-08-25:

- G1.1 is complete in `3edfb86a`: 10,000 deterministic shrinking traces each
  passed for memory, RocksDB, and the independent rewritten adapter. The full
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
  timeout, and queued-cancellation oracle. ADR-0018 remains Proposed until
  G1.7, not because G1.4 evidence is missing.
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
  The receipt covers transactions owned by the update binding. G1.5c still
  owns cancellable negotiated admission for a generic backend, while
  caller-owned transactions require caller rollback and are outside this
  receipt. G1.5c and G1.6 therefore keep ADR-0019 Proposed.

Use writer serialization first. Evaluate RocksDB `TransactionDB` or optimistic
conflicts only as a later frozen hypothesis if serialization creates a measured
production bottleneck.

### G1 application-task corpus and implementation order

The engineering corpus begins with callable product behavior, not G0 evidence
repairs. G1.1 is the green reusable reference oracle. A product-repair task is
not registered with the engineering harness until its product baseline is
genuinely red under a separate evaluator-only commit; G1.2 is the first such
task.

| Task | Evaluator path | Public command | Independent command | Impacted-regression command |
|---|---|---|---|---|
| G1.1 | `lib/oxigraph/tests/transaction_state_model.rs` | `cargo test --locked -p oxigraph --test transaction_state_model` | `cargo test --locked -p oxigraph --test transactional_dataset` | `cargo test --locked -p oxigraph --test update_atomicity` |
| G1.2 | `lib/oxigraph/tests/transaction_concurrency.rs` | `cargo test --locked -p oxigraph --test transaction_concurrency` | `cargo test --locked -p oxigraph --test transaction_state_model` | `cargo test --locked -p oxigraph --test update_atomicity` |
| G1.3 | `lib/oxigraph/tests/transaction_capabilities.rs` | `cargo test --locked -p oxigraph --test transaction_capabilities` | `cargo test --locked -p oxigraph --test transaction_state_model` | `cargo test --locked -p oxigraph --test transactional_dataset` |
| G1.4 | `lib/oxigraph/tests/rocksdb_writer_serialization.rs` | `cargo test --locked -p oxigraph --test rocksdb_writer_serialization` | `cargo test --locked -p oxigraph --test transaction_concurrency` | `cargo test --locked -p oxigraph --test update_atomicity` |
| G1.5 | `lib/oxigraph/tests/sparql_egress_policy.rs` | `cargo test --locked -p oxigraph --test sparql_egress_policy` | `cargo test --locked -p oxigraph --test sparql_update_load_http` | `cargo test --locked -p oxigraph --test sparql_service_http` |
| G1.5b | `lib/oxigraph/tests/sparql_update_cancellation.rs` | `cargo test --locked -p oxigraph --test sparql_update_cancellation` | `cargo test --locked -p oxigraph --test rocksdb_writer_serialization` | `cargo test --locked -p oxigraph --features http-client,rdf-12 --test sparql_egress_policy` |
| G1.5c | `lib/oxigraph/tests/sparql_negotiated_update.rs` | `cargo test --locked -p oxigraph --test sparql_negotiated_update` | `cargo test --locked -p oxigraph --test transaction_capabilities --test rocksdb_writer_serialization` | `cargo test --locked -p oxigraph --features http-client,rdf-12 --test sparql_update_cancellation --test sparql_egress_policy --test transactional_dataset` |
| G1.6 | `cli/src/service_description/tests.rs` | `cargo test --locked -p oxigraph-cli service_description::tests` | `cargo test --locked -p oxigraph --test sparql_version` | `cargo test --locked -p oxigraph-cli --no-default-features service_description::tests` |
| G1.7 | `lib/oxigraph/benches/transactional_write.rs` plus the G1 regression manifest | `cargo bench --locked -p oxigraph --bench transactional_write` | `cargo test --locked -p oxigraph --test transaction_concurrency` | `cargo test --locked -p oxigraph --test update_atomicity` |

Engineering task contracts live below
`tools/engineering-harness/tasks/g1/<task-id>/contract.json` and bind the
baseline commit, evaluator commit, mutable/blocked paths, features, targets,
three command roles, time/output/resource ceilings, and success criteria.
The G1.1-G1.5b evaluator files and the G1.2-G1.5b task contracts are
implemented. G1.5c and later task contracts remain gated on their direct
evaluator-only commits. G1.5 covers remote egress; G1.5b covers cancellation
for update-owned transactions. Neither erases the separately outstanding
negotiated generic-admission boundary.

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

| Task | Depends on | Size | Exit gate |
|---|---|---:|---|
| G2.1 Transactional namespace registry | G1.3-G1.4; evaluator freeze after `HARNESS-REGISTRY` | M | Namespace changes commit/rollback with data without affecting dataset equality |
| G2.2 Normalized semantic change set | G1.1, G2.1 | L | Quad, create, clear, drop, and namespace effects remain distinct; large clear/drop need not expand synchronously |
| G2.3a Durable outcomes and atomic receipts | G1.3-G1.4, G2.2 | L | Durable key reservation, commit ID, primary state, and receipt commit atomically; lost-response/reopen lookup proves committed, durably absent, or indeterminate without replay |
| G2.3b Authoritative transaction outbox | G2.3a | L | Receipt and ordered semantic events share the primary commit; at-least-once replay and deduplication have no crash gaps |
| G2.3c Outbox retention, leases, and governance health | G2.3b | L | Expiry, slow consumers, backpressure, compaction, backup interaction, and minimal governance-health fixtures fail closed without unbounded work |
| G2.4a Full staged-view SHACL commit gate | G1.4, G2.3c | L | Concurrent-invalid outcomes cannot both commit over the complete selected graph contents/topology |
| G2.4b SHACL failure and receipt closure | G2.4a | M | Cancellation, timeout, limit, processor failure, mutable shapes, and bounded receipt evidence reject atomically |
| G2.5 Metrics, readiness, circuit breakers | G2.3c | M | Bounded-label metrics, lag/readiness, cancellation, and failure-mode fixtures pass without payload leakage |
| G2.6 Backup receipt and creation | G2.3c, G2.5 | M | Completed receipt binds store/schema/commit/sequence/cursors plus file inventory and checksums |
| G2.7 Restore verification and drills | G2.6 | M | Fresh-directory restore opens, passes storage validation, verifies topology/namespaces/outbox/index cursors, and records baselined RPO/RTO |

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
workflow precedes RocksDB BackupEngine complexity. The backup receipt binds the
store UUID, schema version, source commit ID, RocksDB sequence, outbox/index
cursors, file inventory/checksums, and a completion marker.

SHACL validation is network-free, bounded, and fail-closed. External policy
shapes are version-pinned at begin. If a transaction mutates its shapes graph,
the validator uses the resulting staged shapes and forces full validation;
incremental validation is only a later differential optimization.

### G3 — optimize after correctness

| Task | Depends on | Size | Exit gate |
|---|---|---:|---|
| G3.1 Statistics provider and feedback | G2.3c, G2.5-G2.7 | XL | Exact graph/predicate counts, bounded sketches/top-K, freshness commit, estimated/actual rows and q-error |
| G3.2 Bounded join planning | G3.1 | L | Dynamic programming for small BGPs and greedy fallback improve the frozen corpus without semantic change |
| G3.3 Async text index | G2.3c, G2.5-G2.7 | XL | Tantivy candidate verification, lag cursor, rebuild, and strict/eventual consistency contracts |
| G3.4 Async spatial index | G2.3c, G2.5-G2.7 | L/XL | Per-CRS envelope candidates refine through exact `spargeo`; generation swap and delta overlay are recoverable |
| G3.5 Federation planner | G1.5, G3.1-G3.2; G1.6 for promotion/advertisement | XL | Catalog/source selection/bound joins obey per-endpoint budgets and `SERVICE SILENT` semantics |

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

| Task | Depends on | Size | Exit gate |
|---|---|---:|---|
| G4.1 Service identity and authorization | G1.5-G1.6 | XL | Principal propagation plus coarse endpoint/whole-operation and direct Graph Store authorization fail closed without leaking protected data |
| G4.2 Workload admission and operator resources | G1.4-G1.5; G4.1 for principal quotas | XL | Queue, deadline, memory/row/byte/concurrency budgets, cancellation, fairness, and bounded telemetry survive overload without weakening transaction or egress guarantees |
| G4.3 Safe storage schema upgrades | G2.7 | L | Version discovery, preflight, backup receipt, resumable shadow copy, source-preserving cutover, crash matrix, and old/new binary compatibility fail closed |
| G4.4 RDF4J REST interoperability | G2.3c, G4.1-G4.2, G4.5 | XL | A versioned endpoint profile passes an exact RDF4J client/HTTP corpus for statements, namespaces, query/update, contexts, transactions, errors, and content negotiation |
| G4.5 Leased remote HTTP transactions | G2.3a, G4.1-G4.2 | XL | Opaque leases, expiry, idempotent terminal operations, disconnect/crash cleanup, and bounded ownership prevent orphaned writers and ambiguous replay |
| G4.6 Multi-repository lifecycle | G2.7, G4.1-G4.3 | XL | Create/open/close/delete/backup/restore operations are authorized, resource-isolated, receipt-bound, and safe under concurrent administration |
| G4.7 Incremental entailment projections | G2.3c, G2.7 | XL | Insert/delete/clear/drop truth maintenance differentially matches full recomputation; unsupported recursion/deletion shapes rebuild or fail typed |
| G4.8 Analytical and WCOJ research path | G3.2; G4.2 for server/`Auto` promotion | Research/XL | A separate optional executor beats frozen cyclic workloads within resource ceilings while matching the ordinary evaluator exactly and preserving its fallback |

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
4. Run `node --test tools/mutation/*.test.mjs`, acquire the current registry
   release with `cargo install --locked cargo-mutants`, require
   `cargo mutants --version` to agree exactly with the version frozen in the
   native outcomes, executable provenance, and new receipt, then run
   `node tools/mutation/oxdatalog.mjs --jobs 2`. Keep ADR-0013's OxDatalog
   scope explicit; P0 needs a separate reviewed mutation or deterministic
   failure-injection competence profile.
5. Reconcile the machine-readable ledger and freeze every protected ADR, plan,
   and research document. MetaHarness hashes these inputs, so editing claims
   after qualification invalidates the receipt.
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

| Risk | Control |
|---|---|
| Stable snapshot is mislabeled snapshot isolation | Concurrent serialization oracle plus dimensioned capabilities |
| Writer lock hides an unacceptable bottleneck | Baseline first; only then evaluate OCC/TransactionDB as a separate ADR/hypothesis |
| Evidence lock is self-approved | Dedicated reviewed refresh; Dream/Darwin cannot edit it |
| Exact test inventory drifts | Required counts and IDs fail closed; add a narrow persistence profile |
| Harness optimizes its own score | Product artifact first, immutable evaluators, independent critic, proportionality cap |
| Prompt or config injects shell/publication authority | Dream activation blocked until literal argv, protected paths, local-only, and provider policy are enforced |
| Outbox duplicates or skips | Atomic receipt/outbox, at-least-once cursor, idempotent consumer key, crash matrix |
| Incremental SHACL misses an affected node | Full staged-view oracle first; fall back on shape change; continuous sampled differential |
| Derived index changes semantics | Exact primary verification, explicit lag, rebuild, correctness fallback |
| Planner overfits one benchmark | Multiple structural workloads, per-query regressions, q-error and resource telemetry |
| Volatile Ruflo state is mistaken for product config | Keep runtime state untracked; commit only reviewed plans, ADRs, and future thin adapters |

## Ruflo and research ledger

The design was coordinated by Ruflo swarm
`swarm-1787600160271-7e42i2`, topology `hierarchical-mesh`, three specialized
research lanes, human-only promotion, and no OpenRouter provider route.

| Track | Ruflo task | Result |
|---|---|---|
| Dream Machine source/install/fit | `task-1787600167777-nwxrh1` | 0.1.1 local CLI useful; unattended routine blocked |
| Repository harness and ADR drift | `task-1787600167739-xfkq2y` | Jena lock, runner lock, Agentic counts, mutation freshness, and evidence prose require repair |
| SOTA RDF storage/optimization | `task-1787600167815-d5ki1t` | Correctness first; serialize writers, then receipts/SHACL/ops/statistics/indexes/federation |
| Dream installation proof | `task-1787600167854-42vvou` | User-scoped 0.1.1, deterministic compile, no schedule/publication/provider execution |
| MetaHarness assessment | `task-1787600167962-6qk4jb` | Non-authoritative local observation: genome ready, score 71, point-in-time OIA clean/generic, Darwin dry-run, synthetic PASS |

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

| Plan IDs | Ruflo task rows |
|---|---|
| G1.5c / G1.6 / `HARNESS-REGISTRY` / G2.1 | `task-1787667172994-ru8mm1` / `task-1787603736309-5dnsls` / `task-1787676052834-q1rbfr` / `task-1787603736400-274ola` |
| G2.3a / G2.3b / G2.3c | `task-1787670631130-9jlo3h` / `task-1787670631321-dewzgm` / `task-1787670631517-qjoyw1` |
| G2.4a / G2.4b | `task-1787670631682-97ibi4` / `task-1787670631837-w5ac24` |
| G4.1 / G4.2 / G4.3 | `task-1787670631989-m5vxqk` / `task-1787670632138-mq9112` / `task-1787670632284-k0cti5` |
| G4.4 / G4.5 | `task-1787670632568-gk92vo` / `task-1787670632421-dkucm8` |
| G4.6 / G4.7 / G4.8 | `task-1787670632716-513bjt` / `task-1787670632864-10hfsk` / `task-1787670633003-hoxn3e` |

The original exact map remains at
`task-plans/linked-data-store-g0-g3-2026-08-24`. The corrected v2 map was
stored and read back through the managed Ruflo bridge in the explicit
repository database at
`task-plans/linked-data-store-g0-g4-2026-08-25-v2`. It records the dependency
corrections in this plan, including the non-product `HARNESS-REGISTRY` control.

The Brain-grounded implementation source
`ruflo/v3/@claude-flow/cli/src/mcp-tools/task-tools.ts` shows that the current
native `task_create` schema persists descriptions, priority, assignment, and
tags to `.claude-flow/tasks/store.json` through a whole-file read/write, but
exposes no dependency argument. Rows were therefore created sequentially and
dependencies are encoded as `depends:<plan-id>` tags and in each description.
Those task IDs and descriptions are audit pointers; historical rows can be
stale. Stable G-identifiers, this committed GOAP graph, and the exact v2
AgentDB map remain authoritative. Ruflo's separate
domain task entity models dependencies, but this plan does not claim that the
current MCP task surface enforces them.

## QA score

This plan scores **98/100** against the programme rubric:

| Dimension | Score | Evidence |
|---|---:|---|
| Source and implementation grounding | 20/20 | Local transaction/optimizer/harness source, live Dream source/npm, Brain implementation sources, official comparison docs |
| Scope and architecture | 20/20 | P0-P3 planned work, explicit G4 decisions, ten DDD contexts |
| Dependency and parallelization clarity | 15/15 | G0-G4 graph, three lanes, sequential publication gates |
| Verifiable acceptance | 19/20 | Exact inventories, model/concurrency/crash/security/performance gates; thresholds await baseline freeze |
| Security and promotion control | 15/15 | Native providers, local-only, protected oracles, isolated worktrees, human promotion |
| Operational realism | 9/10 | Current drift and degraded modes explicit; production replacement adapter and recovery baseline remain open |

The withheld points are real open evidence, not documentation debt. No
candidate is promotable until G0 closes and its affected native receipts are
current.
