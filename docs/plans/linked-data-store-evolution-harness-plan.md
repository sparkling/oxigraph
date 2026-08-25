# Linked-data-store implementation and evolution harness plan

- Status: active execution plan; unattended Dream Machine activation blocked
- Date: 2026-08-24
- Updated: 2026-08-25
- Repository: `oxigraph/oxigraph` clone maintained by this fork
- Upstream baseline: `oxigraph/oxigraph`
  `8dcfb6b66cbb077bb2406379abb280d2471970d7`
- Observed fork source before this documentation slice:
  `8c8e984cc30573d3d6cbb40f86b08c8456a25f08`
- Semantic Builder handover reviewed against:
  `e1097e482476030f012da538151fd967614fb619`
- Product plan:
  [persistence writes and linked-data-store parity](persistence-write-and-linked-data-parity-plan.md)
- Harness decision:
  [ADR-0017](../adr/0017-repository-evolution-and-evidence-promotion-harness.md)
- Write-interface decision:
  [ADR-0016](../adr/0016-backend-neutral-transactional-writes.md)
- Outstanding capability decisions:
  [ADR-0018 through ADR-0025](../adr/README.md)

## Outcome

Use a thin Ruflo control plane to execute the existing product plan. Reuse the
repository's Agentic-QE, Jena, W3C, mutation, and MetaHarness runners as the
only evidence authorities. Keep two MetaHarness paths distinct: the existing
`tools/metaharness` package remains a receipt-sensitive semantic qualifier,
while a future private `tools/engineering-harness` package may route, build,
repair, and review application candidates. The green G1.1 reference oracle and
separate red G1.2 evaluator have now landed in `3edfb86a` and `eaf7161c`.
Darwin may improve frozen harness policy only. Dream Machine 0.1.1 is
installed and locally exercised, but it is not configured, scheduled, or
authorized to publish because its current config cannot enforce this
repository's native-provider-only and local-only boundaries.

The first implementation objective is not another feature. It is to establish
the truth of concurrent-write semantics. The RocksDB readable transaction is a
snapshot plus `WriteBatchWithIndex`, committed by
`rocksdb_write_writebatch_wi`; it does not use RocksDB `TransactionDB`,
optimistic transactions, `GetForUpdate`, or conflict validation. The honest
current claim is stable reads, read-your-writes, and atomic batch application,
not snapshot isolation or serializability under concurrent RocksDB writers.

The lowest-risk first implementation is one-writer serialization for RocksDB,
matching the observable one-writer/many-reader model documented by
[Jena TDB](https://jena.apache.org/documentation/tdb/tdb_transactions.html).
Only adopt RocksDB pessimistic/optimistic transactions if a reproducible
write-concurrency baseline justifies the extra conflict machinery; RocksDB
documents ordinary batches and transaction conflict handling as distinct
mechanisms in its [transaction guide](https://github.com/facebook/rocksdb/wiki/Transactions).

## Current truth and blockers

| Surface | Current evidence | Disposition |
|---|---|---|
| Backend-neutral write seam | Implemented and verified in `1da47285` | Preserve the minimal GAT traits; add optional capabilities through extension traits |
| Memory writers | Serialized by the storage transaction lock | Use as the first serial reference behavior |
| RocksDB writers | Snapshot + indexed batch; G1.2 now reproduces lost update and write skew with both commits returning success | Serialize first unless benchmarks justify OCC/TransactionDB; do not advertise isolation while the evaluator is red |
| Jena differential | July profile seals subject `1fe53cef...`; current subject is `997e2579...` | Historical evidence only; separately review and refresh the lock, then run twice |
| Jena runner lock | The profile expects `runner/Cargo.lock`, but a clean checkout does not contain it and `--locked` fails | Restore a reviewed, reproducible lock strategy before the profile refresh |
| Agentic-QE CLI inventory | Expects 133 default and 116 no-default tests; current exact inventories are 144 and 129 | Review counts/IDs and add an exact `persistence-write` profile |
| Pinned source checkouts | RDF Canon, JSON-LD API, JSON-LD Streaming, and N3 submodules are uninitialized in this clone | Initialize their exact registered revisions before source/full evidence verification; never substitute the parent checkout HEAD |
| Mutation receipt | Source-bound to the pre-write-interface library tree | Historical for its sealed OxDatalog subject; verify the harness and regenerate that exact scope before full qualification, without claiming persistence mutation coverage |
| MetaHarness | 13/13 MetaHarness tests and synthetic qualification pass | Full qualification remains blocked by the evidence drift above |
| Engineering MetaHarness | ADR-0017 architecture accepted; G1.1 and red G1.2 evaluators exist, but no package, native worker adapters, Router evidence, or application receipt exists | Implement separately under `tools/engineering-harness`; package presence is not adoption |
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

P3 remains a set of explicit product decisions. Multi-repository lifecycle,
built-in authorization, Jena/RDF4J proprietary APIs and formats, clustering,
and distributed transactions require a named user and a separate ADR. The
harness must not turn comparison breadth into an implementation mandate.

## Repository fit

| Tool or practice | Use now | Activation boundary |
|---|---|---|
| Ruflo hierarchical-mesh swarm | Three independent research/review lanes, persistent task dependencies, anti-drift state | Task completion is not semantic evidence |
| Ruflo goals and memory | GOAP state, exact research findings, replayable decisions | Repository facts stay repository-local; active-WAL retrieval failures do not block delivery |
| Brain | Source-ground Darwin, Ruflo, OIA, and Dream Machine claims | Local source/tests remain authoritative for Oxigraph |
| MetaHarness genome/score/OIA | Readiness and risk diagnostics | Generic identity and scores are advisory |
| Existing `tools/metaharness` adapter | Policy-only qualification against immutable local oracles | Synthetic mode never upgrades to semantic proof; do not make it a worker host |
| Future `tools/engineering-harness` | Native-worker routing, isolated builds/repairs, focused evaluation, and candidate receipts | Not implemented; no semantic or promotion authority |
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
| G0.1 source registration | [ADR-0017](../adr/0017-repository-evolution-and-evidence-promotion-harness.md) | Accepted programme control |
| G0.2-G0.3 Jena evidence | [ADR-0012](../adr/0012-immutable-broad-jena-harness.md) | Accepted |
| G0.4-G0.5 Agentic-QE evidence | [ADR-0005](../adr/0005-agentic-qe-integration.md) | Accepted |
| G0.6 mutation evidence | [ADR-0013](../adr/0013-mutation-competence-and-provenance.md) | Accepted |
| G0.7 evidence freeze/promotion | [ADR-0004](../adr/0004-metaharness-darwin-qualification.md), [ADR-0017](../adr/0017-repository-evolution-and-evidence-promotion-harness.md) | Accepted policies |
| G1.1-G1.4 transaction truth | [ADR-0018](../adr/0018-transaction-guarantees-and-conflict-model.md) | Proposed |
| G1.5-G1.6 egress/cancellation/claims | [ADR-0019](../adr/0019-unified-egress-cancellation-and-service-claims.md) | Proposed |
| G1.7 promotion | [ADR-0017](../adr/0017-repository-evolution-and-evidence-promotion-harness.md), [ADR-0018](../adr/0018-transaction-guarantees-and-conflict-model.md), [ADR-0019](../adr/0019-unified-egress-cancellation-and-service-claims.md) | Accepted control; product decisions Proposed |
| G2.1-G2.3 metadata/receipts/outbox | [ADR-0020](../adr/0020-transactional-metadata-receipts-and-change-delivery.md) | Proposed |
| G2.4 transaction-time SHACL | [ADR-0021](../adr/0021-transaction-time-shacl-validation.md) | Proposed |
| G2.5-G2.7 readiness/recovery | [ADR-0022](../adr/0022-operational-readiness-backup-and-recovery.md) | Proposed |
| G3.1-G3.2 statistics/planning | [ADR-0023](../adr/0023-statistics-and-bounded-join-planning.md) | Proposed |
| G3.3-G3.4 derived indexes | [ADR-0024](../adr/0024-rebuildable-derived-indexes.md) | Proposed |
| G3.5 explicit federation | [ADR-0025](../adr/0025-explicit-service-federation.md) | Proposed |

### G0 — repair and freeze evidence

Run three independent lanes, then integrate sequentially:

| Task | Owner lane | Depends on | Exit gate |
|---|---|---|---|
| G0.1 Initialize registered source submodules | Evidence | none | Source verifier sees exact registered checkout heads rather than the parent repository |
| G0.2 Restore Jena runner lock reproducibility | Evidence | none | Clean checkout can execute the pinned `--locked` runner |
| G0.3 Review current Jena subject and refresh profile lock | Evidence | G0.2 | Lock diff reviewed; two complete byte-identical runs |
| G0.4 Reconcile Agentic-QE exact CLI counts/IDs | Evidence | none | 144 default and 129 no-default inventories deliberately accepted or corrected |
| G0.5 Add `persistence-write` evidence profile | Conformance | none | Exact IDs cover transactional dataset, update atomicity, topology, service claims, and failure injection |
| G0.6 Verify and regenerate OxDatalog mutation receipt | Evidence | none | `node --test tools/mutation/*.test.mjs` passes; pinned `cargo-mutants` 27.1.0 run has zero survivors/timeouts and reopens its exact source-bound receipt |
| G0.7 Reconcile and freeze protected evidence documents | ADR/claims | G0.1-G0.6 | Ledger, README, ADRs, plans, and research mark historical versus current receipts accurately and are frozen before qualification |

No lock, expected count, manifest, threshold, or receipt is refreshed
automatically by Dream Machine or Darwin.

### G1 — make P0 transaction claims true

| Task | Depends on | Size | Exit gate |
|---|---|---:|---|
| G1.1 State-machine reference model | none; run beside G0 | L | At least 10,000 shrinking traces/backend in CI; every failure has a seed |
| G1.2 Concurrent history oracle | G1.1 | M | Lost-update/write-skew schedules expose current behavior; zero silent anomalies across the frozen stress budget |
| G1.3 Typed request/capability/error extensions | G1.1-G1.2 | L | Effective guarantee returned; unmet minimum rejected; conflict and indeterminate outcomes typed |
| G1.4 RocksDB writer serialization | G1.2-G1.3 | M | Bounded/cancellable gate acquired before snapshot and held through commit/rollback/drop; advertised guarantee passes the 1/4/16-writer oracle while readers remain concurrent |
| G1.5 Unified egress and cancellation | G1.3 | L | Loopback SSRF/redirect/size/timeout fixtures and update rollback pass |
| G1.6 Runtime-derived service claims | G1.3-G1.5 | M | Every advertised capability has a closed endpoint receipt |
| G1.7 Compatibility/performance and promotion gate | G0.1-G0.7, G1.1-G1.6 | M | Existing semantics and current evidence green; approved write/read budgets met |

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
- G1.4 remains product qualification work: the writer gate must pass its
  1/4/16-writer, concurrent-reader, drop, rollback, and cancellation oracle
  before ADR-0018 can move beyond Proposed.

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
| G1.6 | `cli/src/service_description/tests.rs` | `cargo test --locked -p oxigraph-cli service_description::tests` | `cargo test --locked -p oxigraph --test sparql_version` | `cargo test --locked -p oxigraph-cli --no-default-features service_description::tests` |
| G1.7 | `lib/oxigraph/benches/transactional_write.rs` plus the G1 regression manifest | `cargo bench --locked -p oxigraph --bench transactional_write` | `cargo test --locked -p oxigraph --test transaction_concurrency` | `cargo test --locked -p oxigraph --test update_atomicity` |

Future engineering task contracts live below
`tools/engineering-harness/tasks/g1/<task-id>/contract.json` and bind the
baseline commit, evaluator commit, mutable/blocked paths, features, targets,
three command roles, time/output/resource ceilings, and success criteria.
The G1.1-G1.3 evaluator files and the G1.2-G1.3 task contracts are implemented.
G1.4 and later task contracts remain gated on their direct evaluator-only
commits.

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
| G2.1 Transactional namespace registry | G1.3-G1.4 | M | Namespace changes commit/rollback with data without affecting dataset equality |
| G2.2 Normalized semantic change set | G1.1, G2.1 | L | Quad, create, clear, drop, and namespace effects remain distinct; large clear/drop need not expand synchronously |
| G2.3 Commit receipt and atomic outbox | G1.3-G1.4, G2.2 | XL | Transaction key, commit ID, primary state, receipt, and cursor commit atomically; lost-response/reopen lookup proves committed or absent without replay; crash/retention matrix has no feed gaps |
| G2.4 Full staged-view SHACL gate | G1.4, G2.3 | L | Concurrent-invalid outcomes cannot both commit; timeout/failure rejects atomically |
| G2.5 Metrics, readiness, circuit breakers | G2.3 | M | Bounded-label metrics, lag/readiness, cancellation, and failure-mode fixtures pass without payload leakage |
| G2.6 Backup receipt and creation | G2.3, G2.5 | M | Completed receipt binds store/schema/commit/sequence/cursors plus file inventory and checksums |
| G2.7 Restore verification and drills | G2.6 | M | Fresh-directory restore opens, passes storage validation, verifies topology/namespaces/outbox/index cursors, and records baselined RPO/RTO |

The native feed is authoritative and at-least-once. Consumers deduplicate by
`(commit_id, event_index)`. Its records carry schema version and checksum; its
contract defines retention, cursor leases/expiry, slow-consumer backpressure,
and compaction/backup interaction. Restart, lag, cursor expiration, retention
advance, and clear/drop without synchronous expansion must not create gaps.
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
| G3.1 Statistics provider and feedback | G2.3, G2.5-G2.7 | XL | Exact graph/predicate counts, bounded sketches/top-K, freshness commit, estimated/actual rows and q-error |
| G3.2 Bounded join planning | G3.1 | L | Dynamic programming for small BGPs and greedy fallback improve the frozen corpus without semantic change |
| G3.3 Async text index | G2.3, G2.5-G2.7 | XL | Tantivy candidate verification, lag cursor, rebuild, and strict/eventual consistency contracts |
| G3.4 Async spatial index | G2.3, G2.5-G2.7 | L/XL | Per-CRS envelope candidates refine through exact `spargeo`; generation swap and delta overlay are recoverable |
| G3.5 Federation planner | G1.5, G3.1-G3.2 | XL | Catalog/source selection/bound joins obey per-endpoint budgets and `SERVICE SILENT` semantics |

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

1. Initialize the four registered-but-missing test-suite submodules at their
   exact recorded revisions before treating source verification as evidence.
2. Run `(cd tools/agentic-qe && npm ci --ignore-scripts && npm run test:adapter)`, reconcile G0.4,
   then add and run the exact future
   `(cd tools/agentic-qe && npm run test:persistence-write)` profile. The
   existing aggregate remains blocked until its exact inventory is reviewed.
3. After G0.2, refresh the Jena lock only through its reviewed lock operation,
   inspect the diff, then run `bash tools/jena-parity/scripts/run.sh` twice and
   require byte-identical receipts.
4. Run `node --test tools/mutation/*.test.mjs`, require
   `cargo mutants --version` to report 27.1.0, then run
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

The ADR breakout used Ruflo swarm `swarm-1787603675053-t6b9y7` with three
read-only architecture lanes and one root integration writer. All 26 stable
G0.1-G3.5 items were materialized as pending Ruflo task rows on 2026-08-24;
seven separate governance rows track drafting, integration, ledger proof, QA,
and commit without changing programme status. The exact task/ADR/dependency
map is stored and read back at
`task-plans/linked-data-store-g0-g3-2026-08-24` in the explicit repository
database.

The Brain-grounded implementation source
`ruflo/v3/@claude-flow/cli/src/mcp-tools/task-tools.ts` shows that the current
native `task_create` schema persists descriptions, priority, assignment, and
tags to `.claude-flow/tasks/store.json` through a whole-file read/write, but
exposes no dependency argument. Rows were therefore created sequentially and
dependencies are encoded as `depends:<plan-id>` tags and in each description,
with this committed GOAP
graph and the exact AgentDB map remaining authoritative. Ruflo's separate
domain task entity models dependencies, but this plan does not claim that the
current MCP task surface enforces them.

## QA score

This plan scores **98/100** against the programme rubric:

| Dimension | Score | Evidence |
|---|---:|---|
| Source and implementation grounding | 20/20 | Local transaction/optimizer/harness source, live Dream source/npm, Brain implementation sources, official comparison docs |
| Scope and architecture | 20/20 | P0-P2 planned work, P3 ADR boundary, ten DDD contexts |
| Dependency and parallelization clarity | 15/15 | G0-G3 graph, three lanes, sequential publication gates |
| Verifiable acceptance | 19/20 | Exact inventories, model/concurrency/crash/security/performance gates; thresholds await baseline freeze |
| Security and promotion control | 15/15 | Native providers, local-only, protected oracles, isolated worktrees, human promotion |
| Operational realism | 9/10 | Current drift and degraded modes explicit; production replacement adapter and recovery baseline remain open |

The withheld points are real open evidence, not documentation debt. No
candidate is promotable until G0 closes and its affected native receipts are
current.
