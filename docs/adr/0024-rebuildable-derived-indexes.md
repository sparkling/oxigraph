# ADR-0024: Rebuildable derived indexes

- **Status**: Proposed
- **Date**: 2026-08-24
- Updated: 2026-09-08
- Deciders: Oxigraph parity programme
- Implementation status: G3.0 native local lifecycle implemented: snapshot/delta
  inputs, durable generation reconciliation/activation, bounded provider output,
  crash recovery and G2 readiness/backup/restore integration. G3.3 adds the native
  text provider/Rust query and opt-in SPARQL SERVICE slices below. G3.4 adds the
  native spatial provider/Rust query and opt-in SPARQL SERVICE slices below.
  Separately gated performance/production promotion remain outstanding
- **Depends on**:
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md)
- **Related**:
  [ADR-0014 — End-to-end RDF dataset graph topology](0014-rdf-dataset-graph-topology.md),
  [ADR-0023 — Statistics and bounded join planning](0023-statistics-and-bounded-join-planning.md),
  [ADR-0032 — Incremental entailment projections](0032-incremental-entailment-projections.md)

## Context

At programme inception Oxigraph provided exact GeoSPARQL functions but no
persistent spatial or full-text index. Making either index part of the primary commit
would enlarge the correctness-critical storage transaction and couple the core
API to one engine. Making it asynchronously authoritative would instead allow
lag, crash, or corruption to change query answers silently.

Both capabilities need the same lifecycle contract: durable input, explicit
freshness, rebuild, generation swap, failure isolation, and a correctness path
that does not trust the index.

## Decision

G3.0 first implements one provider-neutral lifecycle for rebuildable consumers
of ADR-0020's durable outbox. Its contract includes provider/schema identity,
source commit, applied commit, checksummed generation, lag, rebuild state,
bounded delta overlay, cancellation/resource ceilings, atomic activation, and
readiness policy. It contributes backup and restore state through ADR-0022's
canonical zero-or-more hook; index bytes remain reproducible from primary state
and the durable feed. Lifecycle states distinguish building, ready, lagging,
failed, corrupt, and unavailable. An interrupted, corrupt, or incompatible
generation never becomes active. A fake provider must prove crash, rebuild,
activation, cancellation, backup, and restore semantics before an engine is
adopted.

G3.3 and G3.4 then implement text and spatial providers on that lifecycle,
without duplicating it or participating in primary RDF commit.

G3.3 uses a Tantivy-backed text provider behind an engine-neutral query
surface. Stale candidates are verified against primary state. Because that
cannot recover additions missing from a lagging index, a strict query must
wait for `applied_commit >= required_commit`, execute an authoritative
fallback, or return typed `IndexNotFresh`. Eventual results are explicitly
opt-in.

G3.4 starts with immutable per-CRS spatial-envelope generations plus a bounded
delta overlay. Its first profile is limited to the CRS84 geometry inputs the
current exact implementation accepts; later CRSs use separate declared
profiles and indexes. Every candidate is refined through the existing exact
`spargeo` predicates. Coordinate transformation or normalization is admitted
only for a profile with proven semantics and error bounds.
Standard SPARQL evaluation remains independent of both optional indexes.
Entailment projections are not text or spatial indexes and do not inherit this
ADR's eventual-result policy. They require the separate truth-maintenance and
deletion semantics in ADR-0032.

## Acceptance boundary

### G3.0 native input slice (2026-09-08)

`Store::derived_snapshot` captures one RocksDB snapshot behind a bounded
three-attempt physical-checkpoint bracket. `DerivedSnapshot::scan` streams empty
graph declarations, quads and namespaces from that same view; it does not hold
a writer permit or collect the entire namespace registry. A successful
`DerivedScan` binds the full checkpoint, input counts and ordered logical hash.
Callback, cancellation and limit failures return no successful scan receipt;
the caller must discard its partial candidate. Release snapshots promptly since
they can delay native reclamation.

`DerivedSnapshot::delta` reads that same snapshot's outbox and returns only
complete `DerivedCommit` values whose effect hashes match their native receipts.
No-op commits remain explicit. It validates applied commit-end identities,
including exact retention-anchor receipts. Foreign identities, expired cursors,
legacy coverage gaps and oversized overlays reject without a partial applied
cursor. Later writes and retention do not alter a captured view. Record and
logical-byte ceilings apply before provider delivery/overlay insertion; native
buffers and one decoded RDF record are outside these logical limits. Provider
allocation limits remain the lifecycle adapter's responsibility.

The outbox covers governed writes only. A delta is **not** proof of whole-primary
equivalence. `check_current` compares the full physical checkpoint, conservatively
invalidating on any intervening write (including non-semantic maintenance), not
merely a changed governed receipt. This is a point-in-time check, not a writer
lease. Strict generation activation/use must still reconcile an exact primary
view and prevent ungoverned writes from being hidden by a later governed commit.
This slice adds no primary schema token, writer restriction or strict index claim.

The [native input tests](../../lib/oxigraph/tests/derived_inputs.rs) cover a fake
provider's rebuild/insert/delete/clear/drop/namespace replay, rollback exclusion,
257-effect commits, limits, cancellation, callback failure, retention, foreign
lineage, stable snapshots and ungoverned freshness gaps. Run the
[example](../../lib/oxigraph/examples/derived_inputs.rs) with
`cargo run --locked -p oxigraph --example derived_inputs`.
This input increment alone did not complete G3.0; the following native lifecycle
increment closes its remaining local implementation gates.

### G3.0 native durable generations (2026-09-08)

[`DerivedIndex`](../../lib/oxigraph/src/store/derived_generation.rs) owns one
operator-controlled index directory, a stable advisory `LOCK` inode and immutable
generation directories. Creation rejects existing roots. Creation/activation
currently requires Unix directory synchronization and reuses `libc`; the declared
Rust 1.87 MSRV is unchanged (this slice was tested on Linux with Rust 1.98.0).
This is not a distributed lock or hostile concurrent-filesystem
sandbox.

`DerivedProvider` supplies rebuild, optional whole-commit delta application and
mandatory independent reconciliation with the complete primary snapshot.
`DerivedWriter` copies fresh payloads, hashes/synchronizes them and poisons
completion after any output error, even when swallowed. The completion-last
manifest binds provider/schema, physical/governed source, applied commit (the
reconciled source's latest full receipt, if present), optional base fingerprint,
primary scan tuple and exact payload inventory. Building never changes ACTIVE.

Activation reopens/verifies the candidate, reconciles primary input and semantics,
rechecks payload/manifest bytes, synchronizes a temporary pointer and atomically
renames it. Post-rename failure is `ActivationIndeterminate`, not rollback.
Reopen discards only unpublished `ACTIVE.pending`; incomplete/inactive generations
are retained, not automatically pruned. A failed activation with pending scratch
requires reopen before retry. OS lock release survives abrupt process exit.
Tests cover process interruption, not power loss on every filesystem/device.

Strict views retain the **same borrowed `DerivedSnapshot`** used for verification,
not authority for later Store reads. Full checkpoint equality is insufficient:
copied sibling stores can have identical IDs/sequences/receipts and divergent
ungoverned contents. Strict/Ready/Healthy checks also compare exact primary scan
record count, logical bytes and hash. Mismatch is typed `NotFresh` or a lagging/
rebuilding observation; cancellation/limit errors remain errors. Eventual views
are explicitly opt-in and expose applied/source checkpoints. Shared identities
and monotonic sequences are compatibility checks, **not proof of ancestry**.

This correctness baseline scans primary contents and verifies payloads; it makes
no accelerated-query/throughput claim. G3.3/G3.4 must measure this cost before any
separately reviewed optimization, preserving strict completeness. Checksums detect
accidental corruption, not a dishonest provider/operator rewriting every binding.
Providers own semantic reconciliation and their internal working-memory limits.

Default ceilings are 256 payload files/256 MiB and 64 retained generations/4 GiB,
including incomplete candidates. Manifests are at most 1 MiB, inventories at most
4,096 payloads, and old directory inspection stops after 4,098 entries. A manifest
reservation reduces available output bytes. These are logical/file-size bounds,
not disk quotas, RSS/native-allocation caps or automatic garbage collection.
Cancellation/deadlines are cooperative at callbacks and chunk boundaries.

`observation` freshly verifies files and the supplied primary snapshot before
Healthy. These are sampled observations, not a lease or atomic readiness across
later writes. G2 required/fallback policy is unchanged. The separate monitor
reports in-process building/failure; reopen re-evaluates durable active state.

`backup_contribution` freezes manifest/payloads. G2.6 compares its full checkpoint
**and primary scan tuple against the actual packaged database**; exact-primary
contributions must agree and share one bounded scan. Receipt equality cannot
admit ungoverned/sibling drift. The generic G2 format remains unchanged.
`DerivedRestore` reconciles copied bytes against a borrowed primary snapshot
which cannot escape the callback. `import_restored` copies into a fresh inactive
local generation; activation is explicit, not in-place adoption.

The [fake-provider tests](../../lib/oxigraph/src/store/derived_generation_tests.rs)
cover rebuild/delta lifecycle, topology/namespaces, rollback, ungoverned/sibling
divergence, corrupted payloads/manifests/pointers, identity, writer exclusion,
bounded/cancelled/failed builds, interrupted and abrupt-exit activation, reopen,
backup admission, writable/reopened restore and imported index. Run the
[count-only example](../../lib/oxigraph/examples/derived_generations.rs) using
`cargo run --locked -p oxigraph --example derived_generations`.
This closes native G3.0, not either search provider or production qualification.

### G3.3 native text provider/Rust query slice (2026-09-08)

The optional `text-index` feature adds
[`TextIndexProvider`](../../lib/oxigraph/src/store/text_index.rs) on G3.0. It uses
Tantivy 0.26.1 without engine default features and adds no Node application
dependency. Latest compatible dependencies are locked reproducibly; their
declared minimum reaches Rust 1.90 (`ordered-float`), although Tantivy itself
declares 1.86. This lane was validated on Linux/Rust 1.98, not on the workspace's
declared 1.87 minimum. No other dependency upgrade is implied.

Profile `oxigraph.text.literal.v1` indexes one document per quad with a top-level
literal object, including every datatype and language/direction. Full v1 change
codec bytes retain RDF identity, including graph and subject; nested triple
objects are not recursively indexed. Tokens are maximal Unicode alphanumeric
runs, lowercased without normalization, accent folding, stop words or stemming.
Tokens over 256 UTF-8 bytes fail, never silently disappear. `AllTerms`/`AnyTerm`
use distinct tokens, not Tantivy query-parser syntax. Queries admit at most
4,096 bytes/32 distinct terms. Language scope is an exact case-insensitive tag
(empty means untagged), not a language range or direction filter. None graph
means all graphs; explicit default/named/blank graph and predicate filters work.

Score is the count of distinct matched query terms, **not BM25**. Ordering is
descending score then ascending v1 quad bytes, independent of segment layout.
The result exposes candidate count, verified candidate-match count, output-limit
truncation, source/applied full checkpoints and explicit eventual status. In
eventual mode neither a zero match count nor `truncated == false` establishes
completeness against primary contents. All unscoped engine candidates must fit
the candidate ceiling before graph/primary filtering; overflow is a typed error,
not top-K over an accidentally incomplete subset.

Queries require a core `DerivedView`; strict acquisition compares the full
snapshot scan and returns typed `NotFresh` on lag. Eventual acquisition is
explicit. Each candidate is decoded, checked for exact graph/predicate/language
scope and matched tokens, and point-verified through `DerivedSnapshot::contains`
on that retained snapshot. Candidate refinement removes deletions but cannot
recover unindexed additions. Standard SPARQL and primary commits remain
independent; no server route or SPARQL extension is added in this slice.

The durable profile records exact Tantivy version/index format, compiler Unicode
tables and RDF codec mode. Its SHA-256-derived 128-bit provider identity and schema
1 bind core admission/readiness as well as query/open; incompatible upgrades
require rebuilding, not reporting an old profile healthy under the new identity.
The engine commit payload binds the full source checkpoint hash, including the
complete applied receipt. RAM-directory payloads are exported only after commit
and writer/merge completion, through G3.0's checksummed writer. Hydration hashes
the copied bytes against the retained inventory, detecting corruption even after
a view was admitted. Reconciliation independently proves both the exact primary
literal document set **and every token-to-document posting**, not stored text alone.

Default provider ceilings are 100,000 documents, 1,000,000 distinct
token/document postings, 64 MiB directory payload, 10,000 unscoped query candidates,
1 MiB per encoded document and 64 MiB inspected document bytes. Reconciliation
charges primary bytes before allocating expected records. These logical bounds,
G3.0 file/input bounds and a single 15 MB Tantivy writer arena are not RSS quotas:
native buffers, collection overhead and one record/file copy remain outside them.
Directory growth is sampled at document/commit boundaries. Cancellation/deadline
checks surround engine calls and run at copy/posting boundaries; they do not
preempt an already running Tantivy call. Catch-up validates G3.0's complete delta
but currently rebuilds the exact snapshot, including any ungoverned changes.
This RAM/full-scan correctness baseline makes no throughput/latency claim.

The [native tests](../../lib/oxigraph/tests/text_index.rs) cover scope/identity,
strict/eventual lag, retained snapshots, rollback/clear/drop, bounded failures,
post-admission corruption, reopen, abrupt process exit before/after activation,
and backup/restore/import. The independent
[posting tests](../../lib/oxigraph/src/store/text_index_tests.rs) reject missing or
extra postings even when all stored quads are correct. Run the
[usable example](../../lib/oxigraph/examples/text_index.rs) with
`cargo run --locked -p oxigraph --features text-index --example text_index`.
This native API increment is followed by the SPARQL slice below, not completion
of all G3.3/P2.2. Provider-specific frozen performance/promotion receipts remain
separate gates; no provider-backed qualification was run.

### G3.3 local SPARQL text SERVICE v1 (2026-09-08)

The optional [text binding](../../lib/oxigraph/src/sparql/text_service.rs) adds
`PreparedSparqlQuery::on_text_index` and `on_eventual_text_index`. Both consume
one retained `DerivedSnapshot`, privately clone its exact native reader for
ordinary RDF evaluation, and register only `urn:oxigraph:text:search:v1`.
Ordinary `on_store`, HTTP SERVICE policy, SPARQL modes, and service-description
advertisement remain unchanged. There is no CLI/server route in this increment.

```sparql
PREFIX text: <urn:oxigraph:text:>
SELECT ?s ?value ?score WHERE {
  SERVICE text:search:v1 {
    ?value text:query "linked search"; text:score ?score
  }
  ?s <urn:label> ?value
}
```

The body is one BGP of 1–16 distinct fields sharing a literal-result variable.
The anchor binds the matching literal, not its physical RDF subject. Distinct
projected SERVICE rows avoid multiplying joins when several subjects contain
the same literal. Ordinary RDF patterns retrieve subjects under the evaluator's
existing `FROM` merge/blank-node rules. SERVICE graph filters address physical
snapshot graphs independently of outer `FROM`/`FROM NAMED`; these filters are
not an authorization mechanism.

| Fields in the `text:` namespace | v1 contract |
| --- | --- |
| `query` | Required constant plain string; native token/byte bounds apply |
| `mode`, `language` | Constant `text:all` (default) or `text:any`; exact language-tag string |
| `inGraph`, `defaultGraph`, `inPredicate` | Constant graph IRI or `true` for default graph (mutually exclusive), and predicate IRI |
| `consistency` | `text:strict` (default); `text:eventual` additionally requires the eventual Rust binder |
| `limit` | Optional positive integer: SERVICE-wide top-N after projection/equality/deduplication, before outer joins |
| `literal`, `predicate`, `graph`, `isDefaultGraph`, `score` | Variable outputs; missing required graph output rejects a default-graph hit; score counts matched terms |
| `eventual`, `applied`, `source` | Variable outputs: boolean and full-checkpoint SHA-256 fingerprints |

Inputs are not correlated with outer bindings. Put `VALUES`, `FILTER`,
`OPTIONAL`, ordering, and projection outside SERVICE. There is no implicit
100-result limit. All engine candidates must fit the native ceiling before
filtering; explicit top-N is not top-N per outer binding.

`BoundTextSparqlQuery::context()` exposes full source/applied checkpoints and
generation identity before execution. `TextSparqlResults` carries the same
context beside normal SPARQL results, including zero rows. No admitted generation
means applied/generation are absent; admission errors remain typed SERVICE errors.
Strict lag never silently loses additions. Eventual mode may miss additions but
still filters deleted candidates against the retained primary snapshot.

Ordinary extension errors obey `SERVICE SILENT`. Cancellation and incompatible
RDF terms retain native fatal query errors, including during result consumption.
The binding-wide deadline remains an error at the result boundary even if a
SERVICE-local deadline error was suppressed.
Both evaluator and caller cancellation controls are observed. The timeout starts
at binding, includes admission, and is shared across calls and result iteration.
Cooperative controls do not preempt an engine call already executing.

Identical bodies reuse query-local results. Cache ceilings are 16 distinct
bodies, the provider's `max_candidates` total retained rows, and
`max_inspected_bytes` serialized term bytes (conservatively charged before top-N).
These are logical bounds, not RSS bounds; temporary deduplication and native
buffers remain outside them. A ceiling failure returns an error, not partial
SERVICE rows. Index generation contents remain immutable.

The [focused native tests](../../lib/oxigraph/tests/text_service.rs) exercise
joins, more than 100 matches, dataset merges, retained snapshots, lag and empty
eventual results, rollback/reopen, typed errors, version modes and cancellation.
Run the [usable example](../../lib/oxigraph/examples/text_service.rs) with
`cargo run --locked -p oxigraph --features text-index --example text_service`.
Frozen performance/promotion gates remain open; this is callable query behavior,
not a speed, production qualification, or complete G3.3 claim.

### G3.4 native spatial provider/Rust query slice (2026-09-08)

The optional `spatial-index` feature adds
[`SpatialIndexProvider`](../../lib/oxigraph/src/store/spatial_index.rs) and an
engine-neutral `SpatialQuery`, reusing G3.0 without a primary commit hook. The
only new registry package is `rstar` 0.13.0, with default features disabled;
`spargeo` is reused locally. No Node application dependency is added. `rstar`
declares Rust 1.85; the already locked `geo` 0.33.1 declares 1.88. This lane was
tested on Linux/Rust 1.98, not the workspace's declared 1.87 minimum.

Profile `oxigraph.spatial.crs84.rawxy.v1` uses the
[same parser](../../lib/spargeo/src/spatial.rs) as existing exact functions.
WKT's optional CRS must be CRS84; GeoJSON follows the current parser. Coordinates
retain raw XY order: no axis swap, longitude wrapping, reprojection, clamping or
topology repair. For example, a line from longitude 179 to -179 has the current
planar envelope [-179,179], not a new antimeridian interpretation.

The initial admitted profile requires finite coordinates of absolute value at
most `1e150` and topology accepted by `geo::Validation`. Nonempty geometry
collections are rejected even when members individually validate. A regression
with overlapping polygon members triggered `geo` 0.33.1's topology-position debug
assertion during direct exact evaluation. This slice avoids that unsupported
input with a typed error; it does not fix or change ordinary GeoSPARQL evaluation.
Invalid topology and out-of-range/nonfinite coordinates also fail build/query,
never silently disappear from a successful index result. Unparseable or foreign-CRS
primary literals are omitted because existing exact functions cannot return true
for them; the same terms as query geometry return a typed query error.

Empty geometries remain in an always-refined bucket, including empty geometry
collections. An absent envelope does not mean no match. Every other candidate
uses an inclusive bounding-box intersection before the existing exact function.
All 24 SF/Egenhofer/RCC8 relation names are supported in the order
`relation(candidate_literal, query_geometry)`. The three disjoint relations and
empty query geometries inspect all records: overlapping boxes can still be
disjoint, for example a point in a polygon hole. Graph and predicate filters,
primary quad membership and the original exact predicate decide results.

Each document retains canonical v1 quad bytes and the raw envelope, not a native
R-tree serialization. A versioned profile/codec/RDF-mode fingerprint binds the
provider identity. Hydration hashes bytes against the retained inventory and
recomputes envelopes through the shared classifier; a query also independently
reconciles the complete accepted primary geometry set. This closes missing
additions after parser changes or ungoverned writes; checksums alone do not.
The tree is bulk-loaded in memory per query. This full-scan correctness baseline
is not a latency, throughput or broad GeoSPARQL conformance claim.

Catch-up persists the immutable base plus a bounded, ordered semantic-change
overlay. Quad additions/removals and compact graph/all-graph/dataset barriers
replay in order; namespace/topology-only changes do not create documents.
Rollback contributes no effects. G3.0 validates complete retained commits and
requires exact reconciliation before activation. Overlay exhaustion returns
`RebuildRequired`; callers explicitly rebuild. No automatic fallback disguises
an ungoverned coverage gap. Fresh rebuild folds changes into a new base.

Queries accept strict views only; lag/eventual admission fails with typed
`NotFresh`. Results expose full source/applied checkpoints, candidate and exact
match counts, and explicit output-limit truncation. Deterministic order is
ascending canonical quad bytes; all candidates must fit before scope filtering
or output truncation. There is no implicit top-K loss, eventual spatial result,
SPARQL index binding, CLI route or advertisement change in this increment.

Default bounds are 100,000 documents, 1 MiB per encoded record, 64 MiB base plus
overlay payload, 10,000 candidates and 10,000 overlay records. Materialized
documents conservatively charge key/framing/envelope bytes before insertion,
without repeatedly recounting the whole index. Core file/input ceilings also
apply. These are logical bounds, not RSS quotas: base/materialized/expected maps,
one record/file copy and native geometry/tree allocations can coexist.
Cancellation/deadline checks run at record, replay, copy and refinement boundaries;
they cannot preempt a parser, topology-validation, tree-build or exact-engine call.

The [native tests](../../lib/oxigraph/tests/spatial_index.rs) compare all 24
relations against direct exact evaluation over the admitted fixture set, including
holes, boundary contact, asymmetric axes, planar dateline and empty shapes.
They also test typed excluded inputs, scope, retained snapshots, lag, ordered
barriers, rollback, ungoverned gaps, bounded rebuild/catch-up, corruption after
admission, abrupt process exit, reopen and backup/restore/import. Run
`cargo run --locked -p oxigraph --features spatial-index --example spatial_index`
for the [usable catch-up example](../../lib/oxigraph/examples/spatial_index.rs).
The following increment adds spatial SPARQL integration. Frozen
performance/promotion gates remain open.

### G3.4 local SPARQL spatial SERVICE v1 (2026-09-08)

The optional [spatial binding](../../lib/oxigraph/src/sparql/spatial_service.rs)
adds `PreparedSparqlQuery::on_spatial_index`. It consumes one retained
`DerivedSnapshot`, privately clones that exact native reader for ordinary RDF
evaluation, and registers only `urn:oxigraph:spatial:search:v1`. Strict admission
binds the generation to that source. Ordinary `on_store`, existing exact
functions, other registered services, HTTP policy and capability advertisement
remain unchanged. No additional dependency, eventual spatial mode or server
route is added. The text and spatial binders are separate entry points; enabling
both features is not a promise of both indexed services in one bound query.

```sparql
PREFIX spatial: <urn:oxigraph:spatial:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
SELECT ?s WHERE {
  SERVICE spatial:search:v1 {
    ?geometry spatial:geometry "POLYGON((0 0,4 0,4 4,0 4,0 0))"^^geo:wktLiteral;
      spatial:relation geof:sfWithin; spatial:matched ?ok
  }
  ?s <urn:geometry> ?geometry
  FILTER(?ok)
}
```

The body is one BGP with distinct fields and a shared literal-result variable.
`geometry` is a required constant literal admitted by the native v1 profile;
`relation` is a required constant IRI from the 24 supported SF/EH/RCC8 names.
The native operand order remains `relation(candidate_literal, input_geometry)`.
Optional constant `inGraph`, `defaultGraph true` (mutually exclusive), and
`inPredicate` filter native records. `literal`, `predicate`, `graph`,
`isDefaultGraph` and `matched` are variable outputs; the anchor always outputs
the literal, and `matched` outputs true. A required graph output excludes default
graph records. Repeated output variables must agree.

Distinct projected SERVICE rows are returned in canonical-quad order. No
implicit 100-result/top-K limit applies. An explicit positive integer `limit`
truncates after projection/equality/deduplication, before ordinary outer joins;
every native candidate must fit the provider ceiling before scope filtering.
Inputs are not correlated with outer variables; put other operators outside
SERVICE. Ordinary RDF patterns preserve `FROM` merge and blank-node semantics.
Service graph/predicate filters qualify the existence of a matching literal,
not every occurrence in subsequent RDF joins. Constrain those ordinary patterns
too when that is the intended scope. These filters are not access control.

`BoundSpatialSparqlQuery::context()` and `SpatialSparqlResults::context` expose
the full source/applied checkpoints and generation identity independently of
rows, including empty results. Failed admission leaves applied/generation absent
and raises its typed error only when SERVICE is invoked; an unrelated ordinary
RDF query is not rejected just because the optional index is stale.

Admission, pattern, profile and resource failures obey standard `SERVICE SILENT`:
the surviving input row may subsequently join nonmatching RDF data. To require
successful spatial matching even with SILENT, request `matched ?ok` using a
fresh otherwise-unbound variable and require `FILTER(?ok)` outside SERVICE.
Cancellation and incompatible RDF-mode terms remain fatal, with term checks
before SILENT-able pattern errors. The shared deadline starts at binding and
is checked before evaluation and before/after polling final result iterators,
so SILENT cannot hide its expiry and cancellation prevents another lazy poll.
Both evaluator and caller cancellation controls are observed; cooperative checks
cannot interrupt an exact geometry-engine call already in progress.

Identical bodies reuse query-local rows. Cache ceilings are 16 distinct bodies,
the provider's `max_candidates` total retained rows, and `max_index_bytes`
serialized term bytes, conservatively charged before explicit truncation.
Failures do not expose partial SERVICE rows. These are logical bounds, not RSS
quotas. Shared text/spatial row storage and final consumer guards do not change
the separate text syntax, error types or limits. Release retained results promptly.

The [focused tests](../../lib/oxigraph/tests/spatial_service.rs) check all 24
relation names against existing exact functions over the admitted fixtures,
literal deduplication, more than 100 matches, dataset merges, scope, retained
snapshots, typed lag/corruption/profile/cache errors, SILENT bypass/success
filtering, mode guards, cancellation, custom services, and commit/rollback/
catch-up/restart. Run the [usable example](../../lib/oxigraph/examples/spatial_service.rs)
with `cargo run --locked -p oxigraph --features spatial-index --example spatial_service`.
This closes the callable native spatial SPARQL slice, not frozen performance
receipts, production promotion, broad GeoSPARQL conformance or all of G3.4.

### Complete lifecycle and provider boundary

G3.0 must first pass a fake-provider matrix for insert, delete, clear, drop,
rollback, crash, cursor replay, corruption, bounded rebuild/delta, atomic
activation, cancellation/resource ceilings, and backup/restore reconciliation.
Each real provider then passes the same matrix plus its semantic checks.
Additionally:

- strict text queries never silently omit lagging additions;
- eventual mode reports its applied commit and is never the implicit default;
- text candidates are checked against graph and primary-state scope;
- indexed and exact spatial results agree for every supported CRS/profile;
- a missing or corrupt index preserves an exact or typed-unavailable path; and
- lag, rebuild time, resource use, and result equivalence have frozen
  benchmark and failure receipts before promotion.

## Consequences

- Primary commits remain independent of text and spatial engine latency.
- Index lag and rebuild become explicit operational state.
- Strict completeness may wait, scan, or fail typed rather than return a fast
  incomplete answer.
- Text syntax, scoring semantics, and supported spatial profiles require
  separately versioned public contracts.

## Alternatives rejected

- **Synchronously update every index in the primary transaction.** This couples
  availability and commit latency to optional engines.
- **Trust candidate verification alone.** It removes stale false positives but
  cannot discover missing additions.
- **Build a custom persistent spatial tree first.** Immutable generations and
  exact refinement are smaller and recoverable.

## Evidence and task ownership

Exact spatial functions are integrated through
[`spareval`](../../lib/spareval/src/lib.rs) and
[`spargeo`](../../lib/spargeo). G3.0 owns the shared lifecycle; G3.3 and G3.4
own only the text and spatial providers in the
[linked-data-store evolution plan](../plans/linked-data-store-evolution-harness-plan.md).
