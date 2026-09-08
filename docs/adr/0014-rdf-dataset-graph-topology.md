# ADR-0014: End-to-end RDF dataset graph topology

- **Status**: Accepted
- **Date**: 2026-07-27
- Updated: 2026-09-08
- Deciders: Oxigraph parity programme
- Implementation status: implemented for the surfaces and boundaries named
  below
- Update note: the public transactional write seam now requires independent
  persistence planes to preserve empty named-graph topology and graph lifecycle.
  Audited upstream merge `e9d2db1b` retains this ADR's selected-graph `POST`
  lifecycle rather than adopting upstream `ec68e3dd` creation semantics.
- 2026-09-07 update: upstream `7ce152a1`, integrated as `eb0f0cc2`, adds
  ordered merged-default deduplication. The fork retains named-graph-only union
  semantics, source-graph-aware blank-node standardization for explicit
  `FROM`/`USING`, and SPARQL-version term validation across RocksDB and generic
  dataset paths. Disk-backed regressions now bind those requirements.
- **Related**:
  [ADR-0006 — W3C-first RDF, SPARQL, and SHACL 1.2 parity](0006-w3c-first-12-parity.md),
  [ADR-0009 — Snapshot reasoning and explicit materialization](0009-snapshot-reasoning-materialization.md),
  [ADR-0011 — SPARQL VERSION and protocol semantics](0011-sparql-version-and-protocol-semantics.md),
  [ADR-0012 — Immutable broad Jena differential harness](0012-immutable-broad-jena-harness.md),
  [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md)

## Context

An empty named graph has no quad. Reconstructing an RDF dataset only from its
quads therefore loses whether a graph name is paired with an empty RDF graph.
That loss changes dataset equality and isomorphism, graph existence,
`CLEAR`/`DROP` behavior, round trips, protocol status codes, transaction
snapshots, and reasoning inputs.

The current W3C sources support preserving this distinction while also
requiring a careful interoperability claim:

- The 7 April 2026 Candidate Recommendation Snapshot of
  [RDF 1.2 Concepts](https://www.w3.org/TR/rdf12-concepts/#section-dataset)
  defines a dataset as one default graph and zero or more named-graph pairs.
  Its comparison definition ranges over those pairs, including their graphs.
  The specification also notes that some implementations do not track empty
  named graphs and advises applications about that interoperability risk.
- The JSON-LD 1.1 Recommendation's
  [Deserialize JSON-LD to RDF algorithm, step 8.1.2](https://www.w3.org/TR/json-ld11-api/#deserialize-json-ld-to-rdf-algorithm)
  creates and adds each non-default RDF graph to the dataset before iterating
  its subjects and triples. An empty `@graph` therefore still contributes a
  graph.
- The current Working Draft of
  [SPARQL 1.2 Update `LOAD`](https://www.w3.org/TR/sparql12-update/#load)
  parses a source without `INTO` as an RDF dataset and merges it into the graph
  store. With `INTO GRAPH`, it parses an RDF graph and makes encountering a
  named graph an error.
- The current Working Draft of the
  [SPARQL 1.2 Graph Store Protocol](https://www.w3.org/TR/sparql12-graph-store-protocol/#graph-management)
  distinguishes missing RDF graph content from existing content. For stores
  that support empty graphs, its `PUT` rules explicitly permit creating an
  empty named graph from an appropriate empty RDF representation.

Preservation is therefore an Oxigraph semantic and product contract. It is not
a claim that RDF 1.2 requires every implementation to retain empty named graphs
internally, and it does not erase the interoperability note in RDF 1.2
Concepts.

## Decision

Treat RDF dataset graph topology—the default graph plus the membership of all
named graphs—as first-class state independent of quad content. Preserve that
state through every dataset-aware Oxigraph surface. If an output surface cannot
represent it, fail explicitly instead of silently discarding it.

### Model contract

The [OxRDF dataset model](../../lib/oxrdf/src/dataset.rs) maintains an explicit
named-graph registry alongside its quad indexes.

- The default graph is always present.
- Inserting a quad into a named graph also registers that graph.
- Inserting a graph name may create an empty named graph.
- Clearing a graph removes its quads but retains named-graph membership.
- Removing or dropping a named graph removes both its membership and quads.
- Clearing the whole dataset removes all named-graph membership and quads.
- Dataset equality, dataset isomorphism, and graph-view presence include
  topology, not just quads.

This registry is the authority for graph existence. No sentinel triple or
synthetic quad represents an empty graph.

### TriG and JSON-LD I/O

Dataset-aware parsers and serializers preserve graph declarations separately
from emitted quads:

- The [TriG parser and serializer](../../lib/oxttl/src/trig.rs) record graph
  blocks even when their bodies are empty and can emit explicit empty blocks.
- The JSON-LD
  [to-RDF](../../lib/oxjsonld/src/to_rdf.rs) and
  [from-RDF](../../lib/oxjsonld/src/from_rdf.rs) paths retain empty IRI- and
  blank-node-named `@graph` objects.
- The format-neutral
  [parser](../../lib/oxrdfio/src/parser.rs) exposes dataset collection that
  combines parsed quads with recorded graph membership.
- The format-neutral
  [serializer](../../lib/oxrdfio/src/serializer.rs) emits dataset topology for
  TriG and JSON-LD. It rejects a dataset with empty named graphs when the
  selected format cannot express them.

A quad iterator cannot communicate a graph that produced no quad. Streaming
quad APIs therefore remain intentionally quad-only; callers requiring topology
must use `collect_dataset` or another dataset-aware API. N-Quads and graph-only
formats are not described as lossless empty-graph interchange formats.

### Store, transactions, and reasoning

The [Store](../../lib/oxigraph/src/store.rs) and both storage backends retain a
named-graph registry separately from encoded quads.

- Transactional reader and slice loads collect the full dataset and insert its
  graph names and quads in one transaction.
- Bulk loads carry parsed graph names through their loader before commit.
- Store and transaction snapshots copy named-graph membership as well as
  quads.
- `TransactionalDataset` and `WritableDataset` expose graph membership and
  lifecycle independently of quads, so a replacement backend cannot implement
  generic SPARQL Update while silently collapsing empty graphs.
- `clear_graph` retains graph existence; `remove_named_graph` removes it.
- Persistent storage retains empty graph membership across reopen.
- Store dumps emit empty graphs in representable dataset syntaxes and fail
  closed otherwise.

The [reasoning adapter](../../lib/oxigraph/src/reasoning.rs) evaluates an owned,
topology-preserving store or transaction snapshot. Explicit materialization
registers its target named graph before inserting inferred quads, so a valid
materialization with no inferred quads still has the requested graph lifecycle.
This does not broaden the snapshot and materialization guarantees in
ADR-0009.

The 2026-09-08 materialization repair uses the existing graph-prefix index for
selected-graph copying, including explicit merged-default inputs. Previously,
each named graph caused another full quad scan. Default-graph exclusion,
ground-triple deduplication, empty graph registration and per-source blank-node
standardization are unchanged. The native preservation tests and the same-data
[LDBC query comparison](../../bench/query-benchmark.md#ldbc-q7-materialization-diagnostic)
support this performance correction, not new entailment or promotion claims.

### SPARQL 1.2 `LOAD`

The [SPARQL update evaluator](../../lib/oxigraph/src/sparql/update.rs) applies
the operation's effective version from ADR-0011:

- In SPARQL 1.2 mode, `LOAD` without `INTO` retrieves and collects an RDF
  dataset, then merges both its graph membership and quads into the graph
  store.
- `LOAD ... INTO GRAPH <g>` accepts a graph payload, rejects a payload
  containing named graphs, and registers `<g>` even when the retrieved graph
  has no triples.
- Retrieval, parse, or validation failure leaves the pre-operation graph
  topology unchanged. `SILENT` changes error reporting according to the
  update operation; it is not permission to leak partial graph creation.
- The SPARQL 1.1 mode retains its version-bounded default-graph behavior rather
  than inheriting the 1.2 dataset merge.

The corresponding HTTP fixtures are in
[the `LOAD` integration tests](../../lib/oxigraph/tests/sparql_update_load_http.rs).

### Graph Store Protocol

The [Graph Store handler](../../cli/src/graph_store.rs) derives named-graph
existence from the store registry, not from whether a quad can be read.

- `GET` and `HEAD` distinguish an existing empty named graph from a missing
  graph; the former has a successful empty-graph representation and the latter
  is not found.
- `PUT` replaces the selected graph and creates or retains its graph slot even
  when the valid RDF graph payload contains no triples.
- `POST` merges into an existing selected graph and returns `404 Not Found`
  without allocating graph membership when that selected named graph is
  missing. This is an intentional fork contract. For selector-less Graph Store
  requests, Oxigraph applies
  [Graph Store Protocol §5.5 HTTP POST](https://www.w3.org/TR/sparql12-graph-store-protocol/#http-post)
  by returning `204 No Content` and allocating nothing for a zero-length
  request body. A non-zero, syntactically valid RDF document that parses to
  zero triples is still an RDF graph payload: Oxigraph allocates its graph IRI,
  returns `201 Created`, and records the resulting empty graph. This keeps an
  empty HTTP body distinct from an RDF representation of an empty graph.
- `DELETE` removes selected named-graph membership and its quads.
- Mutations are transactional by default, including graph allocation and RDF
  parsing, so a failed request cannot leak an empty graph.

Upstream commit `ec68e3dd` instead creates a missing selected graph on `POST`.
The audited two-parent merge `e9d2db1b` records that ancestry but deliberately
rejects that hunk. Focused handler and wire tests bind missing-selected `POST`
to `404`, existing-selected `POST` to `204 No Content`, and selector-less
creation independently.

The selector-less dataset `GET`, `HEAD`, `PUT`, and `DELETE` routes are
documented Oxigraph extensions rather than Graph Store Protocol conformance
claims. Their
[representation layer](../../cli/src/graph_store/representation.rs) preserves
empty named graphs when the negotiated dataset format can represent them and
returns a representation error otherwise.

For a disk-backed server opened with [`Store::open_read_only`](../../lib/oxigraph/src/store.rs),
`GET` and `HEAD` acquire state from the store's fixed read-only view without
starting a write-capable transaction. Writable servers retain transaction-backed
state acquisition. The focused disk-backed regression covers populated, empty,
and missing named graphs, selector-less dataset topology, stable conditional
`GET`/`HEAD` ETags, read-only mutation rejection, and unchanged persisted state.

### Python and JavaScript bindings

Bindings must not silently weaken the core store contract.

- The Python [Dataset](../../python/src/dataset.rs) exposes construction,
  enumeration, membership, insertion, clearing, removal, equality, and
  isomorphism with empty-graph topology. Its
  [dataset I/O](../../python/src/io.rs) and
  [Store](../../python/src/store.rs) preserve the same rules.
- The JavaScript [Store](../../js/src/store.rs) preserves topology through
  transactional and bulk `load` and through TriG or JSON-LD `dump`; dumping to
  an unrepresentable format fails. The JavaScript `parse()` API remains a quad
  API and cannot represent an empty named graph. Until a dataset-aware
  JavaScript model is exposed, `Store.load`/`Store.dump` are the supported
  topology-preserving JavaScript path.

## Narrow Jena compatibility divergence

The reviewed Jena 6.1.0 profile records precise differential outcomes for
empty-graph operations. The named TriG and JSON-LD round-trip scenarios in the
[RDF inventory](../../tools/jena-parity/inventory/rdf.json), together with the
empty-graph query scenario in the
[SPARQL inventory](../../tools/jena-parity/inventory/sparql.json), are locally
classified `w3c-overrides-jena`: the exercised Jena adapter succeeds but does
not expose the empty graph name, while Oxigraph preserves it.

The `sparql-update-clear-graph` scenario is deliberately different. It is
classified `w3c-permitted-divergence` because SPARQL 1.2 Update permits a store
either to retain or to remove a named graph left empty by `CLEAR`; both
outcomes conform to that provision. This ADR selects retained membership for
Oxigraph and does not reclassify Jena's removal outcome as an override.

These are observations about those exact operations, adapters, configuration,
and pinned Jena version. They are not claims about every Jena storage backend
or API, and they are not a claim that Apache Jena is nonconforming. Oxigraph
accepts this narrow compatibility divergence under ADR-0006 because topology
preservation is its chosen W3C-grounded contract.

## Evidence

| Surface               | Implementation and focused evidence                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Model                 | [Dataset implementation](../../lib/oxrdf/src/dataset.rs) and [topology tests](../../lib/oxrdf/tests/dataset_topology.rs)                                                                                                                                                                                                                                                                                                             |
| TriG and JSON-LD      | [TriG implementation](../../lib/oxttl/src/trig.rs), [JSON-LD parser tests](../../lib/oxjsonld/tests), and [format-neutral topology tests](../../lib/oxrdfio/tests)                                                                                                                                                                                                                                                                   |
| Store and persistence | [Store implementation](../../lib/oxigraph/src/store.rs), [transactional write traits](../../lib/oxigraph/src/store/transactional.rs), [memory backend](../../lib/oxigraph/src/storage/memory.rs), [RocksDB backend](../../lib/oxigraph/src/storage/rocksdb.rs), [store topology tests](../../lib/oxigraph/tests/dataset_topology.rs), and [replacement-backend transaction tests](../../lib/oxigraph/tests/transactional_dataset.rs) |
| Reasoning             | [Reasoning adapter](../../lib/oxigraph/src/reasoning.rs) and [reasoning tests](../../lib/oxigraph/tests/reasoning.rs)                                                                                                                                                                                                                                                                                                                |
| SPARQL `LOAD`         | [Update implementation](../../lib/oxigraph/src/sparql/update.rs) and [`LOAD` HTTP tests](../../lib/oxigraph/tests/sparql_update_load_http.rs)                                                                                                                                                                                                                                                                                        |
| Graph Store           | [HTTP handler](../../cli/src/graph_store.rs), [representation layer](../../cli/src/graph_store/representation.rs), [general HTTP tests](../../cli/src/graph_store_http_tests.rs), and [disk-backed read-only regression](../../cli/src/graph_store_read_only_tests.rs)                                                                                                                                                               |
| Python                | [Dataset and I/O topology tests](../../python/tests/test_dataset_topology.py)                                                                                                                                                                                                                                                                                                                                                        |
| JavaScript            | [Store topology tests](../../js/test/store.test.ts)                                                                                                                                                                                                                                                                                                                                                                                  |

## Consequences

- Empty named graphs survive supported parse, store, transaction, reasoning,
  protocol, binding, and serialization paths.
- Graph existence no longer depends on incidental quad content.
- Graph registries consume storage and must participate in snapshots,
  transactions, persistence, equality, and test oracles.
- Callers choosing a quad-only API accept that empty-graph topology is outside
  that API's value model.
- Formats that cannot represent the topology produce an explicit error rather
  than a superficially successful but lossy export.
- Compatibility reports must classify empty-graph differences by exact
  operation and implementation profile.

## Alternatives rejected

- Infer graph membership from quads: cannot distinguish missing from empty.
- Add sentinel triples: changes the RDF graph and leaks implementation data.
- Silently drop empty graph names during serialization: turns a successful
  round trip into an unreported semantic change.
- Make `CLEAR` and `DROP` synonymous: erases the store's explicit graph
  lifecycle and conflicts with the selected update contract.
- Copy a differential reference outcome unconditionally: makes Jena the
  semantic authority and generalizes beyond the observed adapter.
- Claim every JavaScript quad iterator is topology-preserving: its return type
  has no value that can carry an empty graph.

## Acceptance boundary

This ADR establishes topology preservation only for the named implementation
surfaces and version modes. It does not make N-Quads or graph-only syntaxes
capable of representing empty named graphs, make JavaScript `parse()`
dataset-aware, standardize Oxigraph's selector-less dataset Graph Store
extension, establish complete SPARQL 1.2 Graph Store Protocol conformance, or
close RDF/SPARQL family parity. The cited RDF and SPARQL 1.2 documents retain
their stated Candidate Recommendation or Working Draft status; this decision
does not promote them to Recommendations.
