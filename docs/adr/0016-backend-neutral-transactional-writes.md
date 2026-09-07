# ADR-0016: Backend-neutral transactional RDF writes

- **Status**: Implemented
- **Date**: 2026-08-24
- Updated: 2026-09-07
- Deciders: Oxigraph parity programme
- Implementation status: implemented and verified in `1da47285`, already
  published as an ancestor of `origin/main` `2b9c8917` on 2026-08-24
- Update note: the public traits, built-in adapters, generic SPARQL Update
  binding, rollback/error behavior, and topology regression tests are merged.
  The 2026-09-07 [application demonstration](../research/r1-application-validation-2026-09-07.md)
  additionally verifies the built-in RocksDB server's write/query/rollback and
  process-restart behavior; it does not claim a deployed replacement adapter.
- **Related**:
  [ADR-0009 — Snapshot reasoning and explicit materialization](0009-snapshot-reasoning-materialization.md),
  [ADR-0011 — SPARQL version and protocol semantics](0011-sparql-version-and-protocol-semantics.md),
  [ADR-0014 — RDF dataset graph topology](0014-rdf-dataset-graph-topology.md),
  [ADR-0015 — Parallel bulk-load failure semantics](0015-parallel-bulk-load-failure-semantics.md),
  [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md),
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md)

## Context

The persistence plane in this fork no longer has the same architectural role as
upstream Oxigraph's private `Storage` implementation. The public API already
provided concrete writes through `Store`, `Transaction`, SPARQL Update, Graph
Store Protocol, bulk loading, Python, and JavaScript. It also provided the
backend-neutral `spareval::QueryableDataset` query extension point. It did not,
however, provide a public transactional write contract that a replacement
persistence plane could implement.

Binding a prepared SPARQL update was consequently limited to the concrete
`Store` and `Transaction` types. Publishing the private storage types would
couple external persistence implementations to dictionary encoding, index
layout, RocksDB details, and internal transaction machinery. Adding write
methods to `QueryableDataset` would also combine two different capabilities and
make read-only datasets implement irrelevant operations.

Empty named-graph membership is independent of quad content under ADR-0014, so
a write contract that exposes only quad insertion and removal is insufficient.
`CREATE`, `CLEAR`, and `DROP` need distinct graph-topology operations.

## Decision

Introduce two public traits in `oxigraph::store`:

- `TransactionalDataset` opens a backend-owned read/write transaction and
  defines its error and transaction types using a generic associated type.
- `WritableDataset` represents the transaction-scoped coherent view. It
  exposes pattern reads, named-graph presence, quad mutations, graph lifecycle
  mutations, and consuming `commit` and `rollback` operations.

The contract has the following mandatory semantics:

1. Reads observe prior writes made in the same transaction.
2. Mutations remain isolated from other readers until a successful commit.
3. Commit publishes the complete mutation set atomically.
4. Rollback discards the complete mutation set.
5. Dropping without commit has rollback semantics.
6. Empty named graphs are enumerable and testable independently of quads.
7. `clear_graph` retains named-graph membership, while
   `remove_named_graph` removes both membership and content.

`PreparedSparqlUpdate::on_dataset` binds an update to any
`TransactionalDataset`. One transaction covers the entire SPARQL Update
request. Successful evaluation commits; evaluation failure invokes rollback.
If both evaluation and rollback fail, the returned error preserves both
failures. Backend errors remain source errors and the built-in `StorageError`
continues to map to its established public variant.

The built-in `Store` and `Transaction` implement the new traits. The existing
`on_store` write-only optimization remains in place; updates that require a
read use the same generic evaluator through the built-in adapter. Existing
caller-managed `on_transaction` behavior remains unchanged.

The additive G2.2 API under ADR-0020 exposes `execute_with_changes()` on owned
generic/negotiated bindings and a separate caller-keyed binding. It wraps the
existing transaction rather than changing these minimal traits, returns effects
only after acknowledged commit, and preserves the same evaluation/rollback
boundary. Existing `execute()` and borrowed transaction paths do not pay capture
overhead. Effects are not durable receipts or an authoritative change feed.

The `oxrdf::Dataset` implementation of `QueryableDataset` also exposes its
explicit named-graph registry. This is required for query evaluation over a
transaction staged in an `oxrdf::Dataset`, and fixes the general empty-graph
adapter boundary rather than creating an update-only exception.

## Bounded contexts

The interface is deliberately not a universal storage trait:

| Context | Contract | Boundary |
|---|---|---|
| Query/read | `QueryableDataset` | Read-only algebra evaluation and snapshots |
| Transactional write | `TransactionalDataset` + `WritableDataset` | Atomic, interactive RDF mutations and SPARQL Update |
| Bulk ingest | Existing `BulkLoader`; future backend-neutral bulk capability | Large staged loads, explicit file/batch atomicity |
| Maintenance | Existing concrete backup/optimize operations; future maintenance capability | Backup, compaction, validation, recovery |
| Derived state | Future transaction participant/change-set contracts | SHACL gates, text/spatial indexes, durable feeds |

Keeping these contexts separate prevents a query-only adapter from having to
fake writes and prevents a transactional backend from claiming bulk or
maintenance guarantees it does not provide.

## Consequences

- A rewritten persistence plane can run the complete SPARQL Update evaluator
  without implementing or exposing Oxigraph's private storage representation.
- Backend errors are propagated without flattening them into strings.
- The public API now states the minimum graph-topology and transaction
  guarantees on which update semantics depend.
- The transaction is intentionally single-use at commit or rollback, making
  accidental post-commit mutation unrepresentable.
- The first version does not negotiate isolation levels, expose conflict
  detection, classify an indeterminate commit result, provide savepoints, or
  attach a durable commit identifier. ADR-0018 and ADR-0020 now own that
  hardening work; none is an implicit guarantee of this interface.
- Bulk ingestion, backup, compaction, namespace metadata, change feeds, and
  secondary indexes remain separate capabilities.

## Alternatives rejected

- **Publish the private `Storage` types.** This exposes physical encoding and
  backend implementation details and prevents independent persistence planes.
- **Put writes on `QueryableDataset`.** This conflates capability boundaries
  and makes read-only adapters carry transactional methods.
- **Expose only autocommit methods on a dataset.** A multi-operation SPARQL
  Update could leak partial state and could not guarantee read-your-writes.
- **Model only quads.** This loses empty named-graph topology and changes
  `CREATE`, `CLEAR`, and `DROP` behavior.
- **Copy the Jena or RDF4J object hierarchy.** Their observable transaction
  guarantees are useful comparison points, but their Java API shape is not a
  Rust persistence contract.
- **Include bulk and maintenance in the first trait.** This would require every
  backend to advertise unrelated operational guarantees and would obscure
  their different atomicity boundaries.

## Evidence

- [Trait definitions](../../lib/oxigraph/src/store/transactional.rs)
- [Built-in adapters](../../lib/oxigraph/src/store.rs)
- [Generic SPARQL Update binding](../../lib/oxigraph/src/sparql/update.rs)
- [Custom persistence-plane integration tests](../../lib/oxigraph/tests/transactional_dataset.rs)
- [Empty topology adapter regression](../../lib/spareval/tests/dataset_topology.rs)
- Commit `1da47285` (`feat(store): expose transactional dataset writes`)

The local verification boundary is:

- all `spareval` and `oxigraph` tests and doctests;
- the `oxigraph` RDF 1.2 feature suite;
- all 144 `oxigraph-cli` tests after making an order-sensitive upstream test
  explicit with `ORDER BY` in `f9033c2b`;
- `cargo check --locked --workspace --all-targets`;
- strict Clippy for the affected library targets.

## Acceptance boundary

This ADR is **Implemented** for the public seam and the built-in/fake-backend
evidence named above. Production adoption of a replacement persistence adapter
remains gated by the shared conformance suite and the isolation/conflict
contract in ADR-0018; those are follow-on capability and release
gates, not unimplemented parts of this interface decision. The review was
single-host: no repository evidence was sent to an external review provider
without explicit authorization.

Acceptance does not require full-text search, GeoSPARQL indexing, RDF Patch,
multi-repository administration, or RDF4J/Jena API compatibility. Those are
separate planned capabilities and product decisions.
