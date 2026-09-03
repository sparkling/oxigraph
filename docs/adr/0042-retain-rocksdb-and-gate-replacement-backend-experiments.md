# ADR-0042: Retain RocksDB and gate replacement-backend experiments

- **Status**: Proposed
- **Date**: 2026-09-03
- Updated: 2026-09-03
- Deciders: Oxigraph parity programme
- Implementation status: decision and evidence boundary only. RocksDB remains
  the existing persistent `Store` backend; no replacement adapter, migration,
  comparative benchmark, or production qualification is implemented
- Programme task: `task-1788074788516-p5tvdm`
  (`REPLACEMENT-BACKEND-DECISION`)
- **Depends on**:
  [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md)
- **Related**:
  [ADR-0014 — End-to-end RDF dataset graph topology](0014-rdf-dataset-graph-topology.md),
  [ADR-0015 — Parallel bulk-load failure semantics](0015-parallel-bulk-load-failure-semantics.md),
  [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md),
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md),
  [ADR-0028 — Safe storage schema upgrades](0028-safe-storage-schema-upgrades.md)

## Context

ADR-0016 implements a public, backend-neutral transactional RDF-write seam.
That seam proves that a custom dataset can execute request-atomic SPARQL
Update without depending on Oxigraph's private storage representation. It is
not a complete persistent-storage plug-in: query-lifetime snapshots, concrete
`Store` dispatch, bulk ingestion, backup, read-only opening, recovery,
migration, packaging, and operational tooling remain distinct contracts.

The built-in persistent implementation is still RocksDB. The default
`lib/oxigraph` feature enables `rocksdb`, which binds `StorageKind::RocksDb` to
`RocksDbStorage` on non-Wasm targets. The normal build uses the vendored
RocksDB gitlink `3b446089141659fad25328c5ea3e7ed283df46e4`, identified as
RocksDB `v11.1.2`, and vendored LZ4
`ebb370ca83af193212df4dcbadcc5d87bc0de2f0`, identified as `v1.10.0`.
The opt-in `rocksdb-pkg-config` feature instead accepts a system RocksDB at
version 9.10.0 or newer. That path is a separate build identity, not evidence
equivalent to the vendored pin.

The programme separately assessed TurboKV at upstream commit
[`5706b6ba02d86ff40d950276cfc4cf17bcd3a871`](https://github.com/kingroryg/turbokv/commit/5706b6ba02d86ff40d950276cfc4cf17bcd3a871),
whose Cargo manifest declares version 0.6.0. It is not the published `v0.6.0`
release identity: that tag resolves to
[`46bcba152f957cebf087c8099fedcae57280506b`](https://github.com/kingroryg/turbokv/commit/46bcba152f957cebf087c8099fedcae57280506b).
A live recheck on 2026-09-03 found `5706b6ba` at the upstream default branch,
thirteen commits after the tag. TurboKV has useful recovery engineering and an
atomic one-keyspace write batch, but the audited revision lacks several
contracts the current store uses or the programme requires: a reusable
query-lifetime snapshot, a general staged-read transaction, per-operation
durability selection, public range deletion, external-SST bulk ingestion,
online checkpoint/restore, read-only opening, and comparable RDF workload
evidence. Its public database operations are Tokio-based and asynchronous,
whereas Oxigraph's product `Store` API is synchronous; that runtime boundary is
unresolved product work, not an implementation detail an adapter may hide.

The in-test `RewrittenPersistencePlane` implementations are portability
oracles for the public traits. They are not persistent stores and cannot be
used as evidence that TurboKV or any other engine satisfies the full product
boundary.

## Decision

Retain RocksDB as the sole production-intended persistent backend for the
built-in `Store`. Do not add TurboKV to the workspace, dependency graph,
default feature set, `StorageKind`, CLI, language bindings, packaging, or
migration surface on the current evidence.

This is an evidence-backed defer/reject decision, not a claim that RocksDB is
permanently irreplaceable. It has five consequences for alternative engines:

1. An experiment must live in a dedicated non-default experimental crate or a
   test-only adapter. Its design must name the applicable public
   `TransactionalDataset`, `WritableDataset`, `WritableNamespaceRegistry`,
   `NegotiatedTransactionalDataset`, outcome-aware extension, and separate
   `spareval::QueryableDataset` seams; these traits do not together constitute
   a production storage plug-in. It must not add a production `StorageKind` or
   a product migration path.
2. The first slice is semantic falsification. It must pass the unchanged
   transaction, topology, namespace, outcome, failure, concurrency, and reopen
   oracles before any performance comparison begins.
3. The second slice, if the first passes and is separately authorized, uses
   matched RDF workloads and matched durability. It compares the exact RocksDB
   build identity with TurboKV and at least one better-fitting pure-Rust
   control. Harness scores or a key/value microbenchmark are not adoption
   evidence.
4. Adoption requires a later ADR that names the exact engine and revision,
   chooses its product placement, defines migration and rollback, and binds
   current receipts for every mandatory capability below.
5. Until that later decision is accepted and implemented, all replacement
   adapters remain experimental and unsupported. RocksDB-specific capabilities
   must not be generalized into backend-neutral claims.

### Mandatory adoption evidence

| Boundary                      | Minimum evidence before product integration                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API and dispatch              | Exact write, namespace, capability-negotiation, outcome, and query/snapshot interfaces; ownership and error conversion; no implicit production `StorageKind`                           |
| Runtime lifecycle             | Explicit async-runtime ownership and bridge to the synchronous `Store`; bounded backpressure, blocking-I/O placement, cancellation, shutdown, drop, task join, and failure propagation |
| Packaging and build identity  | Exact candidate revision, feature isolation, dependency/MSRV/target impact, reproducible package identity, and qualification of every shipped runtime/build lane                       |
| RDF transaction semantics     | Atomic multi-index and named-graph-topology publication, read-your-writes, rollback/drop safety, and a complete query-lifetime snapshot                                                |
| Concurrency                   | Exact negotiated capabilities, the shared shrinking state model, lost-update/write-skew histories, bounded admission and cancellation, and reader liveness                             |
| Terminal outcomes             | One commit-attempt transition, caller-keyed durable lookup, lost-response/reopen resolution, corruption rejection, and no automatic effect replay                                      |
| Namespace and future metadata | Namespace atomicity now; a compatible path for ADR-0020 receipts and outbox participation before those capabilities are advertised                                                     |
| Clear, drop, and bulk load    | Bounded large-range deletion and the ADR-0015 bulk-load atomicity/failure contract without silently enumerating an unbounded keyspace                                                  |
| Operations                    | Read-only opening, validation, checkpoint/backup, fresh-directory restore, compaction observability, and explicit unavailable results for unsupported maintenance                      |
| Format and migration          | Versioned physical layout, source-preserving migration, old/new binary behavior, rollback, and the ADR-0028 shadow-upgrade gate                                                        |
| Workload evidence             | Matched RDF query/update/bulk/reopen workloads, raw repetitions, tail latency, CPU, memory, disk, write amplification, recovery time, and pre-registered stop criteria                 |

### Bounded falsification experiment

The existing assessment defines two terminating experimental slices. Neither
slice is authorized or implemented by this ADR.

Before it may claim semantic acceptance, the semantic slice must freeze an
interface/runtime/package receipt covering the applicable public traits, the
sync/async bridge, runtime ownership, bounded admission, cancellation,
blocking-I/O placement, background-task joins, shutdown/drop behavior, exact
candidate revision, and non-default build feature. It may then build a private
adapter with prefix-partitioned logical areas, one serialized writer, a
query-lifetime commit barrier, a staged-read overlay, namespace records, keyed
outcomes, and the engine's strongest audited durability. Any interface drift,
semantic divergence, false terminal outcome, unstable query snapshot,
deadlock, leaked background work, corruption acceptance, or unbounded
clear/drop terminates the experiment.

Only an accepted semantic slice may release a workload slice. Its comparator
must include the exact current RocksDB build and matched durability. Zero
correctness or recovery regressions is mandatory; performance can inform a
later adoption decision but cannot waive a missing capability.

Re-evaluation is useful when at least one of these facts changes materially:

- TurboKV or another candidate exposes the missing transaction, snapshot,
  maintenance, and recovery contracts;
- removing the C++/bindgen dependency becomes a named product requirement;
- a bounded semantic experiment passes the unchanged backend conformance kit;
  or
- matched RDF workload evidence shows a material benefit without violating a
  pre-registered correctness, resource, or operability gate.

## Consequences

- The current persistent `Store` and its operational behavior remain stable;
  this ADR changes no Rust source, dependency, feature, storage format, or
  runtime path.
- The programme can evaluate pure-Rust engines without confusing a trait-level
  portability test with backend support.
- RocksDB's C++ build, bindgen, and native dependency cost remains. That cost
  is accepted provisionally rather than hidden.
- An experimental adapter must implement missing semantics above the candidate
  engine or terminate; those layers are part of its measured cost and risk.
- The optional system-RocksDB build remains separately identifiable and must
  not inherit exact-vendored qualification evidence.
- Existing `REPLACEMENT-ADAPTER-CONFORMANCE` task
  `task-1788042251643-t1d67p` has no selected replacement to implement and is
  cancelled by this defer/reject decision. A future candidate requires a new,
  explicit task and decision rather than silently releasing that task from
  this rejection.

## Alternatives rejected

- **Replace RocksDB with TurboKV now.** The audited engine does not supply the
  complete transaction, snapshot, bulk, backup, restore, and operations
  boundary, and no controlled RDF comparison supports the migration.
- **Add a production TurboKV feature while filling the gaps later.** A public
  feature or `StorageKind` is a support promise and creates format/migration
  obligations before the semantic gate passes.
- **Treat ADR-0016 as the complete storage adapter interface.** That would
  ignore query, bulk, maintenance, recovery, and product-dispatch contexts
  deliberately kept outside the write traits.
- **Use `RewrittenPersistencePlane` as adoption evidence.** It is an in-memory
  test oracle and proves API portability only.
- **Choose from key/value throughput alone.** Microbenchmarks that omit RDF
  fan-out, query snapshots, concurrent updates, recovery, and settled
  maintenance cannot decide this store's backend.

## Evidence

- [Pinned TurboKV versus RocksDB assessment revision](https://gist.githubusercontent.com/sparkling/eb76655d220e3d7f53cf98a746079a6d/raw/5e867caa5e2d167932605a0beefdfafe2a19da5b/turbokv-rocksdb-gist.md),
  revision `5e867caa5e2d167932605a0beefdfafe2a19da5b`, raw SHA-256
  `e676867466c9c109df31dd27579e727b02b5de1f68a0b9dce850bf9cfbc7d781`
- [TurboKV `v0.6.0` release identity](https://github.com/kingroryg/turbokv/commit/46bcba152f957cebf087c8099fedcae57280506b)
- [`lib/oxigraph` feature boundary](../../lib/oxigraph/Cargo.toml)
- [Built-in storage dispatch](../../lib/oxigraph/src/storage/mod.rs)
- [RocksDB implementation](../../lib/oxigraph/src/storage/rocksdb.rs)
- [`oxrocksdb-sys` feature boundary](../../oxrocksdb-sys/Cargo.toml)
- [`oxrocksdb-sys` build selection](../../oxrocksdb-sys/build.rs)
- [Transactional write traits](../../lib/oxigraph/src/store/transactional.rs)
- [Namespace write trait](../../lib/oxigraph/src/store/namespace.rs)
- [Negotiated and outcome-aware write traits](../../lib/oxigraph/src/store.rs)
- [Queryable dataset contract](../../lib/spareval/src/dataset.rs)
- [Replacement-plane transaction tests](../../lib/oxigraph/tests/transactional_dataset.rs)
- [Replacement-plane namespace tests](../../lib/oxigraph/tests/transactional_namespaces.rs)
- [Transaction state model](../../lib/oxigraph/tests/transaction_state_model.rs)

## Acceptance boundary

This ADR is **Proposed**. It records the programme's current evidence-backed
rejection of a TurboKV production replacement and the safe boundary for any
future experiment. It adds no adapter or product capability. The research task
may close after repository documents, the ADR graph, and the task ledger agree
on that defer/reject result.

Moving this ADR to Accepted requires explicit programme-decider confirmation.
Implementing a replacement requires a later accepted ADR plus unchanged
semantic conformance, independent review, operational recovery evidence, and
the normal human promotion boundary. No task completion, Gist, harness score,
benchmark, or upstream release supplies that authority by itself.
