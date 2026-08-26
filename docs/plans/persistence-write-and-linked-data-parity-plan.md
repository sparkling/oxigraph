# Persistence writes and linked-data-store parity plan

- Status: active plan; write seam and G1.3-G1.6 P0 slices complete; the G1.7
  qualification-control scaffold is implemented while P0.5 remains open
- Date: 2026-08-24
- Updated: 2026-08-27
- Repository: `sparkling/oxigraph`, maintained as a fork of `oxigraph/oxigraph`
- Upstream baseline: `oxigraph/oxigraph` `8dcfb6b66cbb077bb2406379abb280d2471970d7`
- Upstream merge: `a2415a4e`
- Transactional write implementation: `1da47285`
- Deterministic upstream test correction: `f9033c2b`
- Conservative service-description reconciliation: `7dc190d3`
- Runtime-derived service claims: `baeabb067c8c8419973842e5e060adf832e3f738`
- Engineering harness registry:
  `4a15caa07df37d884e7c74d4b69c0505ce3de6e1`
- Architecture decision: [ADR-0016](../adr/0016-backend-neutral-transactional-writes.md)
- Outstanding capability decisions:
  [ADR-0018 and ADR-0020 through ADR-0033](../adr/README.md)
- Execution harness:
  [linked-data-store evolution plan](linked-data-store-evolution-harness-plan.md)

## Outcome

The clone is current with upstream through the baseline above. All 32 upstream
commits after the fork point are ancestors of the current branch; there is no
remaining upstream commit to cherry-pick or merge at this baseline.

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
Namespace metadata, durable change delivery, transaction-time SHACL
validation, operational observability, statistics and bounded join planning,
full-text and spatial indexes, and federation planning follow in that
dependency order.

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

| Group | Incorporated changes | Local disposition |
|---|---|---|
| HTTP and CLI | Repeated query arguments, content-negotiation specificity, truthful load failures, `--fail-on-named-graphs` | Incorporated; fork protocol and graph-topology behavior retained |
| Public API | `Slice` field names, `QueryExpression`, `QueryDatasetSpecification`, documented substitution, `DocumentLoader`, custom scalar/aggregate functions | Incorporated and compiled across the workspace |
| RDF and results | RDF/XML invalid-QName rejection, XML result boundary whitespace, result fixture relocation | Incorporated; fork's RDF/XML writer and RDF version boundaries retained |
| Evaluation | Operator construction split, lazy error propagation, CONSTRUCT/MINUS fixes, reduced work after errors, join/order allocations | Incorporated; fork SERVICE SILENT and entailment adapters retained |
| Optimization | Literal equality, EXISTS/cartesian/union rewrites, recursive join optimization | Incorporated with upstream regression fixtures |
| CI/dependencies | Actions, Python, CodSpeed, and workflow updates | Incorporated where compatible with the fork workflows |

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

| ID | Capability | This fork now | Jena 6.2 | RDF4J 6.0.1 | Decision |
|---|---|---|---|---|---|
| G01 | Pluggable transactional write plane | Implemented in `1da47285`; production adapter proof pending | Dataset/transaction APIs, but not the same Rust extension need | SAIL is the storage decoupling point | Keep the narrow Rust traits; P0 conformance |
| G02 | Isolation and conflict contract | Dimensioned requirements/capabilities are implemented; memory and RocksDB advertise a serialized-writer baseline proven by lost-update, write-skew, and 1/4/16-writer tests | TDB2 documents serializable transactions and one active writer | Multiple requested levels and compatible-level discovery; documented MemoryStore/NativeStore SAILs use optimistic conflict failure, without implying every third-party store does | Retain serialization until G1.7 measurement justifies a separate OCC/TransactionDB hypothesis |
| G03 | Transaction lifecycle and uncertain commit | Typed rejected/conflicted/cancelled/indeterminate outcomes exist in the extension contract; built-in `Store` does not claim durable outcome lookup, prepare, savepoints, or active-state inspection | Explicit transaction lifecycle | `begin`, `isActive`, `prepare`, `commit`, `rollback`, unknown state | Implement durable lookup with G2.3a; savepoints remain later scope |
| G04 | Empty named-graph topology | Strong explicit contract across model, store, I/O, protocol, bindings | Narrow observed divergence in the pinned Jena harness | Context APIs; behavior depends on store/operation | Preserve Oxigraph contract; no change |
| G05 | Prefix/namespace metadata | Parser prefixes are transient; store has no registry | Prefix mappings and a Fuseki prefix service | Transactional namespace operations | P1 store metadata capability |
| G06 | Durable change delivery | None | RDF Patch and patch-log ecosystem | Connection/store listeners; notifications | P1 ordered durable feed; RDF Patch adapter optional |
| G07 | Commit receipt/idempotency | No durable commit ID; commit error can be ambiguous | Transaction/log internals, not an Oxigraph-compatible receipt | Explicit unknown-transaction-state error | P1 receipt and cursor, no silent replay |
| G08 | SHACL on write | Snapshot validation API; not a commit gate | SHACL Core/SPARQL and Fuseki validation endpoint | ShaclSail validates during commit | P1 pre-commit participant over staged view |
| G09 | Outbound `SERVICE`/`LOAD` policy | G1.5 implements one deny-by-default policy for `SERVICE`, `LOAD`, and nested retrieval with typed policy failures, origin/IP allow controls, encoded/decoded byte ceilings, time/connection budgets, and remote-read cancellation | SERVICE disable and endpoint-specific timeout/client controls | HTTP client/federation controls | ADR-0019 implemented; retain one fail-closed egress boundary |
| G10 | Update-wide cancellation | G1.5b proves one token across validation, built-in writer admission, owned mutation, and the final pre-commit rollback boundary; G1.5c carries that exact control through negotiated custom-backend and `Store` admission; caller-owned rollback remains explicitly separate | Update timeouts and query abort controls | Query/FedX timeouts and circuit breakers | Preserve the accepted negotiated binding; do not claim update-scoped rollback for a borrowed transaction without savepoints |
| G11 | Truthful service description | G1.6 derives deterministic federation and remote-load disclosure from effective handlers, egress policy, and compiled transport; the exact seven-stage 4/17/1/1/12 verifier accepted the product and rejected all three controls | Broad Service Description/Fuseki feature disclosure | Repository metadata and protocols | ADR-0019 implemented; keep configured capability distinct from remote health/current admission |
| G12 | Operational metrics/admin | Logs and CLI operations; no stable stats/Prometheus/admin task surface | Ping, stats, Prometheus, backup, compaction, tasks | Server/Workbench/Console and slow-query/circuit-breaker work | P1 metrics and recovery; multi-repo admin is a product choice |
| G13 | Backup/restore verification | Backup and optimize exist; recovery is not continuously proven | Live consistent backup and compaction administration | Store-specific recovery tooling | P1 restore drills and receipts |
| G14 | Full-text indexing | No index or SPARQL extension | Lucene text dataset and SPARQL property function | Lucene/Elasticsearch SAIL | P2 optional derived-index capability |
| G15 | Spatial indexing | GeoSPARQL functions; no persistent transaction-consistent spatial index | GeoSPARQL module and spatial index management | GeoSPARQL support | P2; preserve correctness without index |
| G16 | Federation planning | Basic `SERVICE`; no source selection, catalog, or federated plan metrics | ARQ SERVICE controls and extensions | FedX source selection, joins, timeout, monitoring | P2 after egress and statistics |
| G17 | Planner statistics | Query explain exists; no durable cardinality/statistics subsystem | Mature ARQ/TDB planning | Store estimates and FedX plan logging | P2 statistics with correctness-neutral fallback |
| G18 | Transaction participants | No stable validator/index/outbox hook | Dataset wrappers/modules | Stackable and notifying SAILs | P1 narrow change-set/participant API, not a class hierarchy |
| G19 | Multi-repository lifecycle | One server process/store configuration path | Fuseki can manage multiple datasets | Server manages multiple repositories | P3 product ADR; not a core RDF requirement |
| G20 | Protocol/file compatibility extras | Standards-oriented formats and Oxigraph protocols | Jena-specific assemblers, RDF Thrift, patch endpoints | RDF4J REST and Binary RDF | P3 only with a named interoperability user |
| G21 | Service identity and authorization | No built-in principal or coarse server-operation authorization model; egress policy is not inbound authorization | Fuseki authentication/authorization hooks and dataset access controls | Server security plus repository/application authorization integration | ADR-0026; fail closed, keep reverse-proxy versus embedded authority explicit, and do not claim SPARQL row/graph filtering |
| G22 | Workload admission and operator resources | Writer admission and egress budgets are narrow; no unified query/update queue, principal quota, or operator resource contract | Fuseki metrics/tasks and server controls | Query circuit breakers, timeouts, slow-query logging, and resource-aware operators | ADR-0027; one composable budget context, bounded telemetry, no payload leakage |
| G23 | Storage schema upgrades | RocksDB format versions fail closed, but there is no receipt-bound, crash-tested multi-step migration framework | TDB release/upgrade guidance and reload boundaries | Repository/configuration and native-store upgrade paths | ADR-0028 after verified backup/restore; simple additive migrations must still state old/new binary behavior |
| G24 | RDF4J REST interoperability | SPARQL and Graph Store protocols exist; RDF4J repository REST paths, transactions, namespace endpoints, and error shapes are absent | No RDF4J compatibility target | Native Server/Workbench REST contract and client APIs | ADR-0029 defines an explicit versioned compatibility profile, not wholesale Java API emulation |
| G25 | Remote HTTP transactions | No server-side transaction lease protocol | Fuseki/Jena transaction APIs are local/internal rather than this target contract | RDF4J REST exposes remote transaction lifecycle | ADR-0030 defines the native lease state machine; ADR-0029 translates RDF4J requests onto it |
| G26 | Multi-repository lifecycle | One configured store per server process | Fuseki hosts and administers multiple datasets | RepositoryManager/Server manage multiple repositories | ADR-0031; privileged, resource-isolated lifecycle with receipt-bound delete/restore |
| G27 | Incremental entailment projections | Full snapshot evaluation and explicit one-shot materialization exist; no durable incremental projection, support state, applied-commit cursor, or recovery evaluator exists | Reasoner and inference facilities provide comparison outcomes, not this projection/cursor contract | Inferencer SAILs provide an extension comparison, not proof of equivalent durable projection semantics | ADR-0032; rebuildable derived state with full-closure differential and cursor/recovery gates |
| G28 | Analytical/WCOJ execution | `sparopt` and `spareval` remain the only production planner/executor; there is no analytical cursor or WCOJ operator | ARQ/TDB planning is a workload comparison; no WCOJ-equivalence claim is made | Query algebra/evaluation and FedX provide comparison workloads; no WCOJ-equivalence claim is made | ADR-0033; disabled frozen experiment before any explicit or automatic promotion |

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

| Delivery work | Owning ADR | Status |
|---|---|---|
| P0.1-P0.2 conformance, guarantees, conflicts | [ADR-0018](../adr/0018-transaction-guarantees-and-conflict-model.md) | Proposed |
| P0.3-P0.4 egress, cancellation, service claims | [ADR-0019](../adr/0019-unified-egress-cancellation-and-service-claims.md) | Implemented |
| P0.5 compatibility/performance promotion | [ADR-0017](../adr/0017-repository-evolution-and-evidence-promotion-harness.md), ADR-0018, ADR-0019 | Harness registry, rejection-evidence controls, and the G1.7 qualification-control scaffold are implemented; compatibility replay is Agentic-only, qualification-ineligible, and P0.5 remains open |
| P1.1-P1.2 namespaces, effects, receipts, outbox | [ADR-0020](../adr/0020-transactional-metadata-receipts-and-change-delivery.md) | Proposed |
| P1.3 transaction-time SHACL | [ADR-0021](../adr/0021-transaction-time-shacl-validation.md) | Proposed |
| P1.4a-P1.4c readiness, backup, restore | [ADR-0022](../adr/0022-operational-readiness-backup-and-recovery.md) | Proposed |
| P2.1 statistics and bounded planning | [ADR-0023](../adr/0023-statistics-and-bounded-join-planning.md) | Proposed |
| P2.2-P2.3 text and spatial indexes | [ADR-0024](../adr/0024-rebuildable-derived-indexes.md) | Proposed |
| P2.4 explicit federation | [ADR-0025](../adr/0025-explicit-service-federation.md) | Proposed |
| P3.1 identity and authorization | [ADR-0026](../adr/0026-service-identity-and-authorization.md) | Proposed |
| P3.2 workload/resource governance | [ADR-0027](../adr/0027-workload-admission-and-operator-resources.md) | Proposed |
| P3.3 safe schema upgrades | [ADR-0028](../adr/0028-safe-storage-schema-upgrades.md) | Proposed |
| P3.4 RDF4J REST interoperability | [ADR-0029](../adr/0029-rdf4j-rest-interoperability.md) | Proposed |
| P3.5 leased remote transactions | [ADR-0030](../adr/0030-leased-remote-http-transactions.md) | Proposed |
| P3.6 multi-repository lifecycle | [ADR-0031](../adr/0031-multi-repository-lifecycle.md) | Proposed |
| P3.7 incremental entailment projections | [ADR-0032](../adr/0032-incremental-entailment-projections.md) | Proposed |
| P3.8 analytical/WCOJ research | [ADR-0033](../adr/0033-analytical-wcoj-execution.md) | Proposed |

P3 now has named user outcomes and separate decisions. It remains outside the
core write-interface acceptance boundary and is not silently absorbed into
ADR-0018-0025.

ADR-0017's two post-G1.6 harness controls are now closed independently. Commit
`4a15caa07df37d884e7c74d4b69c0505ce3de6e1` makes the canonical task and
command registries authoritative; commit
`afe30c7de7e3df6e72a0a855d83efc612339f261` adds replay-verified application
receipt v6 rejection evidence without granting Router quality. Both controls
remain local-only and non-promoting. G0.6 and G0.7 subsequently closed their
scoped mutation and claim-reconciliation checkpoints; those closures do not
complete ADR-0018 or the G1.7 compatibility/performance promotion gate.

### Slice 0 — upstream and write seam (complete)

| Task | Dependency | Size | Acceptance |
|---|---|---:|---|
| D0.1 Merge upstream through `8dcfb6b6` | none | L | Git ancestry contains all 32 commits; affected baseline suites pass |
| D0.2 Add transactional dataset traits | D0.1 | M | External fake backend compiles; graph topology and read-your-writes are explicit |
| D0.3 Bind generic SPARQL Update | D0.2 | M | Whole request commits atomically or rolls back; custom errors survive |
| D0.4 Preserve built-in performance path | D0.3 | S | Concrete `Store` write-only path remains; legacy update suite passes |
| D0.5 Stabilize unordered upstream test | D0.1 | S | Query states `ORDER BY`; CLI is 144/144 |
| D0.6 Reconcile service-description claims | D0.1 | S | Default and RDF 1.2 builds advertise only receipted SPARQL 1.0/1.1 capabilities |

### P0 — make the write contract trustworthy

#### P0.1 Shared backend conformance kit — L

Dependencies: Slice 0.

- Define a reusable adapter test suite for memory, RocksDB, and the rewritten
  persistence plane.
- Exercise every graph selector, empty named graphs, duplicate inserts,
  deletion of absent quads, `CREATE`/`CLEAR`/`DROP`, `DELETE/INSERT WHERE`,
  `LOAD`, commit, rollback, and drop-without-commit.
- Add injected failures at transaction open, read iteration, mutation,
  rollback, and commit.
- Add model-based operation sequences and compare the final dataset plus graph
  topology, not only quad sets.

Acceptance:

- The same conformance crate runs unchanged against all three backends.
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

#### P0.5 Compatibility and performance gate — M

Dependencies: P0.1–P0.4.

The local G1.7 control preserves the outer qualification receipt v1 while
requiring explicit v2 schemas for newly minted semantic and compatibility
`PASS` projections. Structural verification proves serialization, hashes, and
schema state only; sealed verification reopens the inventory and replays copied
MetaHarness and Agentic-QE owner contracts. Compatibility currently reaches
only `AGENTIC_OWNER_CONTRACT_REPLAYED`, does not independently replay native
Cargo lane summaries, and cannot make `qualificationEligible` true. Legacy
unversioned `PASS` evidence remains `LEGACY_REPLAY_ONLY`. This scaffold does not
replace the benchmark, semantic, compatibility, or human-promotion acceptance
requirements below.

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

#### P1.1 Namespace registry — M

Dependencies: P0.2.

- Add a separate store metadata capability for prefix-to-IRI mappings.
- Make namespace changes transactional when mixed with RDF writes.
- Define scope, persistence, iteration ordering, import/export behavior, and
  whether parsing prefixes are persisted only by explicit request.

Acceptance:

- Namespace mutations commit and roll back with RDF changes.
- Prefix metadata never changes RDF dataset equality or graph topology.
- Turtle/RDF/XML serializers can opt into the registry without making output
  nondeterministic.

#### P1.2 Staged change sets, commit receipts, and durable feed — XL

Dependencies: P0.1 and P0.2.

- Record normalized quad, graph-topology, and namespace changes in the
  transaction.
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

Acceptance:

- Prometheus output, if chosen, has bounded labels and no query text, RDF data,
  credentials, or user identifiers by default.
- Health does not report ready when the writer, durable feed, or required index
  is unrecoverably unavailable.

#### P1.4b Backup receipts and creation — M

Dependencies: P1.2 and P1.4a.

- Start with a checkpoint-plus-manifest design. Bind store UUID, schema
  version, source commit ID, RocksDB sequence, outbox/index cursors, file
  inventory/checksums, start/end state, and a completion marker.
- Exercise compaction/optimize with concurrent reads and blocked or rejected
  writes according to its documented contract.

Acceptance:

- Interrupted backups never carry a completion marker or pass receipt
  verification.
- Backup, retention, outbox, index cursors, and compaction advance without an
  unrecorded consistency gap.

#### P1.4c Restore verification and drills — M

Dependencies: P1.4b.

- Restore into a fresh directory, open the store, run its storage validator,
  and verify topology, namespaces, outbox position, and index cursors.
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

#### P2.2 Full-text index — XL

Dependencies: P1.2, P1.4a-P1.4c, and preferably P2.1.

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

Dependencies: P1.2, P1.4a-P1.4c, and existing `spargeo` correctness tests.

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

Dependencies: P0.3, P1.4a, and P2.1.

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

## Release gates

No phase is complete until all applicable gates pass:

- `cargo fmt --all -- --check` and `git diff --check`;
- strict Clippy for changed targets, with any unrelated baseline failure
  recorded separately;
- default and RDF 1.2 affected test suites;
- workspace all-target check;
- adapter conformance on memory, RocksDB, and rewritten persistence;
- concurrency and injected-error tests for transaction work;
- loopback-only security fixtures for external request work;
- semantic and differential harnesses for claimed compatibility;
- reviewed Jena runner/subject locks and exact Agentic-QE command inventories
  that match the candidate source;
- a source-bound OxDatalog mutation receipt for its exact scope before full
  MetaHarness qualification, without treating it as persistence coverage;
- benchmark comparison for hot read/write/index paths;
- no documentation-site navigation or publication change without separate
  authorization.

The `rocksdb-pkg-config` all-features lane requires a system `rocksdb.pc` and is
an environment prerequisite, not evidence that the vendored RocksDB lane
failed. CI should run vendored and system-library lanes separately.

## Risks and controls

| Risk | Control |
|---|---|
| Public GAT traits become difficult to evolve | Keep the first trait minimal; add optional extension traits/capability objects; add compile fixtures for external implementers |
| Backend advertises guarantees it does not implement | Conformance kit plus explicit effective capabilities; fail closed on unmet minimums |
| Commit failure is mistaken for rollback | Typed indeterminate outcome and durable receipt lookup |
| Automatic conflict retry duplicates external effects | No implicit replay; retry only an explicitly replay-safe operation with an idempotency key |
| SHACL or indexes create a giant storage trait | Staged change-set/participant context with narrow responsibilities |
| Derived index drifts after crash | Atomic participation or durable outbox, lag metric, rebuild and oracle comparison |
| Egress policy is bypassed by redirect or DNS change | Validate every resolution and redirect; pin/connect safely; bound bytes and time |
| Metrics leak RDF/query content or create unbounded cardinality | Metadata-only defaults, bounded labels, privileged diagnostics |
| Competitor parity expands without bound | Require an observable user outcome and an ADR; keep Java API/file-format compatibility out of core |
| Future upstream merge overwrites fork semantics | Path-based merge audit plus focused semantic tests and ADR review |

## Research and Ruflo ledger

The research was split into three evidence tracks and persisted in the
repository's Ruflo memory:

| Track | Ruflo task | Memory key |
|---|---|---|
| Upstream/write architecture | `task-1787593372180-0hjfvi` | `research/oxigraph-2026-08-24-r1-upstream-write` |
| Apache Jena comparison | `task-1787593372163-lmmndv` | `research/oxigraph-2026-08-24-r2-jena-gap` |
| Eclipse RDF4J comparison | `task-1787593372137-3j8kyo` | `research/oxigraph-2026-08-24-r3-rdf4j-gap` |

Exact recall from all three entries succeeded. Ruflo's higher-level
`ContextSynthesizer` reported unavailable, so it was not used as evidence. The
neural predictor had real embeddings but no stored patterns and returned no
prediction; it did not influence prioritization. The synthesis above is the
traceable intersection of recalled local findings and current first-party
sources.

The Brain search verified the persistent swarm implementation in
`ruflo/v3/@claude-flow/cli/src/mcp-tools/swarm-tools.ts`; that source supports
the research ledger mechanics, not any claim about Oxigraph, Jena, or RDF4J.

## QA score

The plan scores **98/100** against the programme rubric:

| Dimension | Score | Basis |
|---|---:|---|
| Source authority and currency | 20/20 | Exact local commits plus current official Jena/RDF4J pages |
| Implementation traceability | 20/20 | Public API, tests, commits, and Ruflo memory keys named |
| Dependency and boundary clarity | 15/15 | DDD contexts and task prerequisites are explicit |
| Architectural decision coverage | 10/10 | ADR-0019 is implemented; ADR-0018 and ADR-0020 through ADR-0033 own every remaining admitted P0-P3 public or operational seam without claiming implementation |
| Verifiable acceptance criteria | 14/15 | Negative, crash, concurrency, security, and performance gates; production adapter still pending |
| Risk and security coverage | 10/10 | Commit ambiguity, replay, egress, index drift, and leakage covered |
| Scope discipline | 9/10 | Core versus product choices separated; P3 decisions remain independently gated and unimplemented |

The two withheld points are real open state, not formatting debt: a production
replacement adapter has not yet run the conformance kit, and the newly admitted
P3 decisions do not yet have product receipts. ADR-0016 is Implemented for the
public write seam and ADR-0019 is Implemented for egress, cancellation, and
runtime-derived service claims; ADR-0018 and ADR-0020 through ADR-0033 remain
follow-on work under this plan.
