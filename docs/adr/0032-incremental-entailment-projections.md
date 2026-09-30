# ADR-0032: Incremental entailment projections

- **Status**: Proposed
- **Date**: 2026-08-25
- Updated: 2026-09-30
- Deciders: Oxigraph parity programme
- Implementation status: bounded outbox/full-closure reference evaluator and
  opt-in finite-RDFS full-recompute derived provider implemented. Ordinary query
  entailment still uses full snapshots or explicit one-shot materialization;
  no incremental algorithm or query overlay is activated
- Programme task: `task-1787670632864-10hfsk` (G4.7)
- **Depends on**:
  [ADR-0009 — Snapshot reasoning and explicit materialization](0009-snapshot-reasoning-materialization.md),
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md)
- **Related**:
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
cursor, frozen evaluator receipt, or benchmark receipt exists yet; G4.7 owns that work.

## Ordinary reference evaluator (2026-09-29)

`lib/oxigraph/tests/entailment_projection_reference.rs` adds a test-only
governed outbox replay model compared with the existing full RDFS closure after
bounded mutation traces. It checks source quads and empty graph topology,
alternate support/deletion, rollback, duplicates, receipt/witness and cursor
identity, truncation and corruption. A mid-apply fault proves rollback and
positive recovery. The shrinker preserves failure category. An ungoverned-write
negative control proves that an outbox cursor alone cannot establish Strict
freshness. No production implementation or semantic baseline changes.

Exact test SHA256:
`55854377bea0ac3d0bc6c62ba8397a6efb8b3b1e9a3acae3240594c9f0c0ddbb`.
Original batch `workflow-4JdfeU` failed; E0521 and rejected missing-control
reviews remain negative evidence. Direct same-task repair used the recorded
Opus proposal, followed by fresh Sonnet 5.5/high review
`1e24d232-d27c-4890-849b-11d008490088`, reviewer
`49e4ad3c-a5ce-46ec-8bf4-eaae75a11f54` (ACCEPT).
Response SHA256:
`d6191d036861c1cecd6173b63d866bb56e63a656c7f888c2ee370e771ebc9a75`.

Candidate `source-rQmWBY` from accepted `6649e7e1d` passed six tests each
with default/RDFS and no-default/RDFS (`run-GfVIg1`, `run-EzhnSi`). Formatter
passes. Clippy exits 0 with warnings, not a clean-lint claim. Request/response
identity, author independence, 15 read dependencies and 15,220 unchanged source
files were verified. Subsequent lease and custody-harness commits changed no
projection application evaluator or review inputs; all 15 read hashes were
rechecked before serial integration. All prior external actions had stopped.

On canonical source based on `93a944d57`, default/RDFS reference tests pass six,
query-entailment tests pass 17 and outbox tests pass eight (`run-uwyZO8`);
no-default/RDFS reference tests pass six (`run-5zGXoi`). Counts are top-level,
not nested crash-helper summaries. Both source/sourceAfter bindings matched
exact current source before this evidence append.

This accepts ordinary test development only, not an incremental algorithm,
durable cursor, Strict query provider or frozen qualification gate. Original
G4.7 uses migration alias `task-1790674619203-1j3qcu`; umbrella remains open.
ADR remains Proposed. No default/server activation or qualification follows.

## Opt-in materialization admission prerequisite (2026-09-30)

`QueryEntailmentOptions` now accepts opt-in fact and estimated-byte ceilings.
Unsupported bounded profiles refuse explicitly. The Store snapshot hook admits
each decoded quad or named-graph declaration before accumulation; empty-graph
names consume the byte budget too. Existing cancellation checkpoints and default
unbounded behavior remain. One decoded record already exists before admission:
this is neither a decoder allocation bound nor a process RSS guarantee. Working
stages have separate logical ceilings; existing finite-engine ceilings still
apply. No incremental provider, durable cursor, query overlay or server is enabled.

Original provider rejection and native stalls remain negative evidence. Root's
snapshot hook and recorded Opus consumer repair received fresh full three-file
review. Accepted analytical work changed four supplemental inputs, so owner
created fresh `source-RGKlmt` from accepted `6149cf617`; old-source acceptance
was not inherited. Fresh review `9b40bb2c-22d9-4671-b33d-ab7c6083b3c5`, native
Sonnet5.5/high reviewer `653817bb-1a63-49a1-9a58-bb5348d40d59`, returned ACCEPT
before September30 Sol route adoption. Exact request, worker, receipt, source
and supplemental hashes were verified. The later deployed harness-only delta
through `759b6e31d` changes no application input; explicit reconciliation is in
`target/engineering-delivery/projection-prerequisite-integration-9b40bb2c-22d9-4671-b33d-ab7c6083b3c5.json`.

Candidate and canonical no-default/RDFS checks each pass 130 top-level tests:
107 library, six reference-evaluator and 17 query-entailment tests. Canonical
session `79080` reused the exclusively owned `projection-limits` target. These
are direct owner observations, not runner receipts: the recorded runner rejected
the existing nested target path with `Cargo target must name one private ordinary
build directory`. Candidate no-default/RDFS/OWL2-RL/Datalog library check passes;
scoped formatter and diff checks pass. Warnings remain. This slice has no new
default/RocksDB matrix, frozen semantic receipt or performance claim.

Only the admission prerequisite is accepted. Full G4.7 provider defects,
resource/recovery gates and original task remain open. ADR stays Proposed.

## Bounded full-recompute provider (2026-09-30)

The opt-in RocksDB/RDFS provider now uses the existing derived-generation
lifecycle for build, replay, full recomputation, reconciliation and activation.
Source quads and named-graph declarations are admitted before replay retention;
inferred records remain separate from primary RDF. Governed cursor identity,
canonical framing and checksums are validated. Ungoverned primary changes need
independent reconciliation and rebuilding, never cursor-only strict freshness.
An initially unidentified source cannot silently adopt its first governed lineage.

Failed recomputation invalidates inferred state before fallible work. Cooperative
control checks cover replay, framing and final decode/publication boundaries.
RDFS errors preserve cancellation, timeout, resource and semantic categories.
Test-only scoped thread-local observation reaches actual engine checkpoints for
cancellation and positive-deadline controls. Logical ceilings are not process
RSS bounds; sorting/native calls are not preemptible. Full recomputation is not
an incremental algorithm, query overlay, server activation or performance claim.

Fresh native Sol 6.1/high review `b3f8859a-c0bd-4185-a8ed-753bc0956e48`,
worker `01a0f2a5-5848-7440-8f68-09fc0e8b97e1`, accepted all six source files.
Response SHA256:
`9fb8a042c0f2fb95dc1e69a99c86e720ce727046fa825d90c351de412c3bbc42`.
Owner verified exact request/response identities, stopped native custody,
28 reads and 15,255 unchanged source inputs against main `1e3e2a058`.
The intervening catalog-test acceptance was explicitly reconciled. Evidence:
`target/engineering-delivery/provider-final-integration-b3f8859a.json`.

Canonical direct checks on the exact reviewed source passed:

- Provider unit controls: 12 (`session20402`).
- Default/RDFS provider, reference, query and outbox: 42 (`session97345`).
- No-default/RDFS library, reference and query: 130 (`session33122`).
- RDFS classifier/control tests with RDF12: nine (`session55119`).
- Default-feature library check: exit 0 (`session51556`).

Candidate focused/impacted checks also pass; candidate Clippy exits 0 with
warnings. Scoped formatter with `skip_children=true` and diff checks pass.
A recursive formatter check reported pre-existing descendant formatting; no
unrelated source was changed. These are owner observations, not manufactured
runner receipts. Earlier rejected reviews, failed tests and native stalls remain
negative evidence. Query consistency, broader recovery/resource gates and
separately authorized qualification remain open on the same G4.7 outcome.
ADR remains Proposed; no default promotion, protected-data change or publication.

## Retained payload inventory binding (2026-09-30)

Provider loading now reuses `DerivedFiles::read_verified` for RDFS payloads.
Copied `meta`, `image` and `inferred` bytes must match the admitted generation's
retained size/hash inventory, not only their own internally consistent metadata.
Wire format, public API, bounds and final control checks remain unchanged.
The new public regression replaces all three files with another valid generation:
before repair it incorrectly loaded successfully (`session6451`, retained RED);
after repair it returns `Corrupt`. This is a hydration integrity prerequisite,
not a query overlay, snapshot-consistency admission or incremental algorithm.

Fresh native Sol6.1/high review `e10747f4-5044-45d4-9654-81890137f45f`, worker
`01a0f2db-c720-71c1-86d8-97ade658af39`, ACCEPTs exact three-file source; response
SHA256 `1420ca196d72cd01663b5d59b4f30f28f230a09b97723a6172699e05716b5735`.
Owner verified request/receipt/custody, eight reads and 15,256 unchanged inputs,
reconciling only the accepted three-path harness correction since parent
`86faf32c`. Evidence: `target/engineering-delivery/hydration-integration-e10747f4.json`.

Canonical checks pass 24 derived-input/provider/reference tests (`session21181`),
12 provider unit tests and default-feature library check (`session54405`).
Reviewed hashes still match after validation; scoped nightly formatting and diff
checks pass. Candidate integration/unit checks each pass 12. Compiler warnings
remain. Counts are direct owner observations, not runner-issued qualification
receipts. Earlier native stalls remain negative; no stalled proposal was applied.
Same G4.7 outcome stays open. ADR remains Proposed; no server/default activation,
qualification, protected-data mutation or publication follows.
