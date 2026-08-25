# ADR-0032: Incremental entailment projections

- Status: Proposed
- Date: 2026-08-25
- Updated: 2026-08-25
- Deciders: Oxigraph parity programme
- Implementation status: not implemented; entailment currently uses full
  snapshot evaluation or explicit one-shot materialization
- Programme task: `task-1787670632864-10hfsk` (G4.7)
- Depends on:
  [ADR-0009 — Snapshot reasoning and explicit materialization](0009-snapshot-reasoning-materialization.md),
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md)
- Related:
  [ADR-0014 — End-to-end RDF dataset graph topology](0014-rdf-dataset-graph-topology.md),
  [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md),
  [ADR-0021 — Transaction-time SHACL validation](0021-transaction-time-shacl-validation.md),
  [ADR-0023 — Statistics and bounded join planning](0023-statistics-and-bounded-join-planning.md),
  [ADR-0024 — Rebuildable derived indexes](0024-rebuildable-derived-indexes.md),
  [ADR-0027 — Workload admission and operator resources](0027-workload-admission-and-operator-resources.md),
  [ADR-0028 — Safe storage schema upgrades](0028-safe-storage-schema-upgrades.md)

## Context

Oxigraph can evaluate bounded RDF, RDFS, OWL 2 RL/RDF, and Datalog profiles
over a stable owned snapshot. It can also explicitly replace a caller-owned
named graph with one-shot D0/D1 materialization. Query-time entailment still
copies the visible store dataset and computes a complete closure for each
prepared query. ADR-0009 deliberately leaves incremental insertion/deletion
maintenance, provenance persistence, scheduling, and staleness to a later
decision.

Repeated full closure is expensive for read-heavy stores, but inferred triples
cannot silently become primary truth. Incremental deletion is also harder than
incremental insertion: recursive and multiply supported consequences require
support tracking, over-deletion and rederivation, or a full rebuild. Graph
clear/drop/recreate, active-vocabulary axioms, blank nodes, profile changes,
and crash replay prevent a quad-only cache from being a sound solution.

## Decision

Introduce optional entailment projections as rebuildable derived state. A
projection is identified by store UUID, profile and profile version, source
dataset/graph scope, datatype and consistency policy, rules or schema digest,
projection schema version, generation, and applied ADR-0020 commit. Base RDF,
named-graph topology, and transactional namespaces remain authoritative and
are never rewritten merely because a projection exists.

The first admitted profiles are the repository's finite same-graph RDF 1.2 and
RDFS 1.2 closures and the already bounded OWL 2 RL/RDF profile. Custom Datalog
is eligible only for a separately frozen D0/D1 monotone profile with stable
rule identity. D2 rules that generate existential blank nodes remain rejected:
incremental replay must not mint new identities on every delta. Non-monotone
rules, remote imports, arbitrary functions, and profile changes outside a
versioned generation also force typed unsupported or full rebuild behavior.

The derived representation stores inferred quads separately from primary
quads together with enough support information to retract consequences. The
initial correctness oracle is delete/rederive:

1. apply committed additions and lifecycle changes to the generation's source
   view;
2. invalidate consequences reachable from removed facts or schema terms;
3. rederive candidates from the remaining base and supported consequences;
4. compare bounded invariants and the resulting cursor; and
5. publish the delta or a fully rebuilt generation atomically.

Implementations may later use counting, seminaive differential dataflow, or a
more selective dependency graph, but every promoted algorithm continuously
differential-tests against full snapshot materialization. When dependency
analysis cannot prove a safe bounded affected region—especially for graph
drop, active-vocabulary contraction, rule changes, corruption, or unsupported
blank-node identity—the projection schedules a fresh generation instead of
guessing.

The projection consumes ADR-0020's normalized durable outbox. Quad additions
and removals, named-graph create/clear/drop, and ordering boundaries remain
distinct. Rollbacks produce no projection input. At-least-once delivery is
deduplicated by commit/event identity, applied cursors advance only after the
derived transition is durable, and restart resumes from that cursor. Projection
bytes are excluded from primary backups when the ADR-0022 receipt contains the
configuration, generation metadata, cursor, and rebuildability proof; an
operator may include them only as a validated acceleration artifact.

The proposed Rust query seam is an additive
`EntailmentProjectionProvider`/`EntailmentProjectionStatus` capability and a
prepared-query binding equivalent to
`on_store_with_entailment_projection(store, projection, options)`. It does not
alter `QueryableDataset`, `Store`, or ordinary
`on_store_with_entailment`. Options pin the profile, source graph scope,
required base commit, deadline, memory/fact limits, and one consistency mode:

- `Strict` waits for the exact required commit within policy, computes the
  existing full snapshot closure as an authoritative fallback, or returns
  typed `ProjectionNotFresh`;
- `Recompute` always uses the full snapshot oracle and may repair the
  projection asynchronously; or
- `Eventual` is explicit and returns projection generation and applied commit
  metadata with the result context.

Strict is the server default wherever an entailment projection is selected.
A query never combines base snapshot commit `C` with derived state at another
commit while calling the result strict. Failure after result streaming begins
returns an error; it does not restart against another generation and duplicate
rows. Query cancellation and ADR-0027 budgets cover waiting, overlay access,
fallback materialization, and repair scheduling.

Inferred quads are read-only overlays. SPARQL Update, Graph Store Protocol,
dataset equality, export, and ordinary `Store` iteration continue to see
primary RDF unless a separate explicit materialization operation is called.
SHACL validation under ADR-0021 uses its transaction-pinned inference policy;
it cannot silently trust an asynchronously stale projection. Statistics may
describe projection-backed query views only when profile, graph scope, and
applied commit match exactly.

## Security and operational behavior

- Projection evaluation and repair are network-free. Rules, schemas, and
  imports are immutable content-addressed inputs admitted before processing.
- Facts, IRIs, literals, rule text, and inferred payloads are absent from
  default metrics and logs. Bounded metrics include profile ID, state, cursor
  lag, generation, fact-count bucket, rebuild disposition, and resource use.
- Lifecycle states are `Building`, `CatchingUp`, `Ready`, `Lagging`, `Failed`,
  `Corrupt`, `Incompatible`, and `Unavailable`. Only a validated generation can
  become active; atomic swap retains the prior valid generation until readers
  release it.
- Checksums cover configuration, rule/profile identity, source store identity,
  generation metadata, support schema, and cursor. Schema or profile mismatch
  is incompatibility, not an empty projection.
- Readiness policy declares which projections are required. A failed optional
  projection degrades to full snapshot evaluation; a required projection that
  cannot meet its strict policy fails readiness.
- ADR-0027 bounds concurrent rebuilds, delta size, support fan-out, memory,
  disk, wall time, and catch-up work so a mutation cannot trigger unbounded
  synchronous reasoning in the primary commit.

## Explicit non-goals

- Mutating source graphs or exposing inferred quads as primary RDF.
- General incremental Datalog, negation, aggregates, arbitrary functions, or
  D2 existential generation.
- Claiming complete W3C SPARQL entailment-regime conformance beyond the dated
  profiles already accepted by their semantic evaluators.
- Synchronously expanding every clear/drop inside the primary transaction.
- Using a projection as the only copy of data or making it mandatory for
  embedded/custom datasets.
- Letting eventual staleness become an implicit query default.

## Staged evidence gates

1. **Full-closure differential evaluator.** After every operation in a
   replayable mutation trace, compare the projection overlay with the existing
   full snapshot evaluator for the exact profile, including quads and empty
   named-graph topology.
2. **Retraction and identity evaluator.** Cover alternate and recursive
   supports, schema deletion, cycles, active vocabulary, insert/delete,
   clear/drop/recreate, rollback, graph scoping, RDF 1.2 triple terms, legal
   blank nodes, and repeated D2 fail-closed behavior.
3. **Cursor and recovery evaluator.** Inject crash, duplicate delivery,
   truncated events, checksum damage, generation-swap failure, cursor expiry,
   compaction, rebuild, backup, and restore. No corrupt or partially caught-up
   generation becomes active.
4. **Query consistency evaluator.** Strict, recompute, eventual, absent,
   lagging, corrupt, and incompatible states preserve their exact result/error
   contract under concurrent base commits and cancellation.
5. **Benchmark gate.** Pinned RDFS/OWL/Datalog mutation and query corpora record
   query p50/p95, update-to-visible lag, write amplification, support bytes per
   base fact, rebuild time, peak RSS, and full-materialization fallback cost.
   Promotion requires a measured target workload benefit with bounded primary
   write regression; no threshold is invented before baselining.

Each profile and maintenance algorithm receives its own source-bound semantic
receipt. Passing a performance gate cannot compensate for one differential
mismatch.

## Consequences

- Repeated entailment queries may reuse a durable, exact derived view.
- Deletes and lifecycle events become explicit truth-maintenance work rather
  than stale inferred triples.
- Primary commits remain independent of reasoning latency, but strict readers
  may wait, recompute, or receive a typed freshness error.
- Support state, cursor retention, rebuilds, and profile migrations add disk
  and operational complexity.
- The full snapshot evaluator remains both the correctness fallback and the
  promotion oracle.

## Alternatives rejected

- **Append inferred triples to a graph after every write.** Deletion,
  alternate support, rollback, and crash can leave stale primary-looking data.
- **Maintain insertions only.** A store supporting delete, clear, and drop
  cannot call such a cache exact.
- **Put reasoning inside the primary commit.** Large closures would make
  commit work unbounded and couple availability to optional semantics.
- **Trust support counts without full differential tests.** Recursive
  derivations and profile axioms can invalidate naive counts.
- **Enable D2 with freshly generated blank nodes.** Replay would not have
  stable existential identity.

## Evidence and task ownership

Current one-shot integration is in
[`reasoning.rs`](../../lib/oxigraph/src/reasoning.rs). Query-time full snapshot
materialization is in
[`entailment.rs`](../../lib/oxigraph/src/sparql/entailment.rs) and
[`entailment/dataset.rs`](../../lib/oxigraph/src/sparql/entailment/dataset.rs),
with profile engines in [`lib/oxrdfs`](../../lib/oxrdfs),
[`lib/oxowl`](../../lib/oxowl), and
[`lib/oxdatalog`](../../lib/oxdatalog). No incremental projection, durable
cursor, evaluator, or benchmark receipt exists yet; G4.7 owns that work.
