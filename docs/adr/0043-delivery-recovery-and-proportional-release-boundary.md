# ADR-0043: Delivery recovery and proportional release boundary

- **Status**: Accepted
- **Date**: 2026-09-07
- Updated: 2026-09-07
- Deciders: Oxigraph parity programme
- Implementation status: the product and validation slice is implemented in
  `eb0f0cc2`; the six-hour scheduler is installed and its wake-up path is
  tested; documentation, task-ledger reconciliation, reproducible-submodule
  disposition, and publication remain in progress
- Programme task: `task-1788770182100-hyaa2v`
- Six-hour review control:
  `programme-controls/oxigraph-six-hour-delivery-course-correction-v1`
- **Amends**:
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md)
- **Related**:
  [ADR-0004 — MetaHarness and Darwin qualification](0004-metaharness-darwin-qualification.md),
  [ADR-0014 — End-to-end RDF dataset graph topology](0014-rdf-dataset-graph-topology.md),
  [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md),
  [ADR-0034 — First-class exact new-file admission](0034-first-class-exact-new-file-admission.md),
  [ADR-0035 — Durable native containment guardian and crash recovery](0035-durable-native-containment-guardian-and-recovery.md),
  [ADR-0036 — Guardian-control pure ABI](0036-guardian-control-pure-abi.md),
  [ADR-0037 — Durable containment statefs and manager protocol](0037-durable-containment-statefs-and-manager-protocol.md),
  [ADR-0038 — Native containment manager, guardian, and launch trampoline](0038-native-containment-manager-guardian-and-trampoline.md),
  [ADR-0039 — Delegated-host containment qualification and readiness](0039-delegated-host-containment-qualification-and-readiness.md),
  [ADR-0040 — Commit-capable containment decision and application-output release](0040-commit-capable-containment-decision-and-output-release.md),
  [ADR-0041 — G1.7 private co-located build issuer and physical owner chain](0041-g17-private-co-located-build-issuer.md),
  [ADR-0042 — Retain RocksDB and gate replacement-backend experiments](0042-retain-rocksdb-and-gate-replacement-backend-experiments.md)

## Context

The programme delivered the backend-neutral transactional write seam on
2026-08-24 in `1da47285`, but did not stop at that releasable product boundary.
It expanded the engineering and qualification machinery while presenting that
work as a prerequisite for the already-implemented application behavior.

The 2026-09-07 delivery audit found:

- 508 commits since 2026-08-24;
- 358 commits classified as harness or qualification work and 56 as product or
  upstream work by the recorded exclusive-subject heuristic;
- 348,196 harness additions versus 30,208 product/other additions relative to
  `origin/main`, so harness code comprised about 92% of code-only additions;
- 420 Ruflo task rows, including 11 still marked in progress before recovery;
- a directly tested write seam that already passed its focused transaction and
  topology tests.

This contradicts ADR-0004's product-first rule, its 20%/two-hour harness cap,
and the Semantic Builder handover instruction not to spend another programme
phase rebuilding evidence infrastructure. It also made task counts, evaluator
generations, and receipts look like delivery even when no new application
capability resulted.

The programme owner therefore stopped the evaluator-first path and directed a
timely application delivery recovery.

## Decision

### 1. Define the current release boundary as R1

R1 consists of exactly:

1. the already-implemented ADR-0016 backend-neutral transactional write API;
2. the current audited upstream product delta, upstream `7ce152a1`, integrated
   locally as `eb0f0cc2`;
3. preservation of the fork's SPARQL version policy, dataset topology, and
   RDF-merge blank-node semantics;
4. affected native, conformance, language-binding, and fuzz validation;
5. truthful README, ADR, programme-plan, Ruflo-ledger, and programme-Gist state;
6. a reproducible submodule graph or an explicit unresolved release hold; and
7. authorized commits and publication to `main`.

No other feature is an R1 prerequisite unless a failing product test or a
named release requirement proves that it is.

### 2. Keep the containment programme, but remove it from the R1 critical path

ADRs 0034 through 0041 remain Proposed. Their implemented authority-null and
dormant slices, frozen evidence, and historical task state are preserved.
Their internal dependency chain remains relevant if that programme is
separately resumed.

They do not gate R1, ordinary product implementation, or a future G2 product
slice. In particular, G1.7 physical benchmark ownership, delegated-host
qualification, commit-capable containment, Dream Machine orchestration,
GEPA/AVO evolution, and provider-backed qualification require a separately
activated task and the authority already required by their own ADRs.

This ADR does not accept, implement, supersede, or delete those proposed
designs. It supersedes only claims that their completion is required before R1
or ordinary application work may proceed.

### 3. Treat linked-data breadth as a roadmap, not one release

The Jena and RDF4J gap catalogue remains useful research. ADR-0018 and
ADR-0020 through ADR-0033 remain the architecture backlog for transactions,
metadata/change delivery, SHACL, operations, indexing, federation, service
security, workload control, migrations, RDF4J interoperability, repository
lifecycle, incremental inference, and analytical execution.

R1 does not promise that entire portfolio. A roadmap item becomes active only
with a named outcome, acceptance tests, and an assigned delivery slice.

### 4. Restore direct product evidence as progress authority

For an application slice, progress means at least one of:

- callable product behavior changes and a focused regression passes;
- an upstream product delta is integrated and its semantic differences are
  resolved;
- a release blocker is removed with reproducible evidence; or
- living documentation is reconciled to implemented code and current task
  state.

Task rows, plans, evaluator scaffolding, generated receipts, model routing,
swarm size, and review volume are supporting evidence, not delivery by
themselves.

### 5. Bound process work

- Keep at most three active delivery tasks and one writer on `main`.
- Use read-only parallel reviewers only for independent, bounded questions.
- Work directly on `main`; do not create feature branches or worktrees.
- Freeze new harness dependencies, evaluator generations, and qualification
  surfaces during R1.
- Apply ADR-0004's maximum 20% harness effort and two-hour review trigger.
- After two evaluator defects for the same slice, stop repairing the evaluator
  chain and use the smallest native product/conformance test that can decide
  the behavior, or redesign the slice.
- Report completion by explicit gates rather than unsupported clock estimates.

### 6. Use proportional release gates

The R1 product delta changes SPARQL evaluation, RocksDB iteration, tests, and
JavaScript/Python binding fixtures. Its required gates are therefore:

- Rust formatting and staged-diff integrity;
- affected `spareval` and `oxigraph` tests, including transactional writes,
  graph topology, merged-default semantics, and SPARQL version policy;
- the pinned Oxigraph SPARQL conformance lane;
- the affected JavaScript and Python binding tests; and
- the required `spareval` query/update fuzz targets for 60 seconds each.

Full MetaHarness qualification, G1.7, live containment, provider-backed runs,
Jena differentials, mutation campaigns, and broad performance claims are not
R1 gates. They may support only the exact claim for which they are separately
authorized and run.

### 7. Preserve merged-default semantics across backends

The upstream `7ce152a1` optimization is adopted with fork constraints:

- a union-default dataset is the RDF set union of named graphs only; it does
  not include the physical default graph;
- explicit `FROM` and `USING` RDF merges retain source-graph provenance so
  blank nodes can be standardized apart by source graph; and
- optimized RocksDB reads pass the same SPARQL-version term validation as the
  generic and in-memory paths.

The two RocksDB-specific regressions in `eb0f0cc2` make backend divergence a
release failure rather than an implementation detail.

### 8. Review course every six hours while R1 remains active

Each review examines commits, scoped diffs, newly closed test gates, failures,
and the product/process effort split from the preceding six hours. If no
delivery artifact or gate closed, the current auxiliary activity stops and the
next product-critical action becomes active.

The review policy and its verified installation receipt are stored in Ruflo
memory under the key named above. The programme owner explicitly authorized an
external scheduler after the native Codex CLI boundary was confirmed. A
user-level `systemd` timer now runs at `00:00`, `06:00`, `12:00`, and `18:00`
Europe/Berlin and invokes native `codex queue` for this exact persisted thread.
The queued turn must use live structured Ruflo MCP tools to retrieve task and
memory state, dispatch a read-only audit worker, and validate both the exact
worker record and daemon run counter before accepting the audit result.

The [scheduled prompt](../plans/oxigraph-six-hour-delivery-review-prompt.md)
was revised to v2 on 2026-09-07 after review of the original control. It names
the R1 delivery outcome, bounds the review to ten minutes and audit observation
to sixty seconds, separates new product behavior and closed release gates from
supporting work, and requires implementation after every review. Audit or
memory failures are reported without starting another harness-repair cycle.
An unresolved release hold is not completion. Once every R1 delivery gate is
verified, the review timer is disabled; the wider roadmap remains recorded.
The installed service message must match the versioned prompt after whitespace
normalization. These bounds govern review overhead, not product execution or
subscription usage.

The timer and service are
`~/.config/systemd/user/oxigraph-programme-review.timer` and
`~/.config/systemd/user/oxigraph-programme-review.service`. The unit files pass
`systemd-analyze --user verify`, the timer is enabled and active, and a manual
service start returned exit status zero after native Codex queued message
`01a07b60-8e18-7ab1-acc3-b7c266c13229` into the intended thread. The first
natural timer firing remains runtime evidence, not a precondition for enabling
the control.

Ruflo worker validation exposed a narrower defect: the enabled audit worker's
daemon counter advanced from 1951 to 1952, but `hooks_worker_status` left the
exact dispatched record pending. The stale record was cancelled. Scheduled
reviews must surface that mismatch and must not treat `queued`, `pending`, or
`synthetic-completed` as proof that a worker result was produced.

## Implemented R1 evidence

The `eb0f0cc2` source state passed:

| Boundary | Result |
| --- | --- |
| `cargo fmt --all -- --check` | pass |
| `cargo test --locked -p spareval --features sparql-12` | all unit, integration, and doctests pass |
| affected `oxigraph` store/query/write tests | 36 passed |
| `cargo test --locked -p oxigraph --features rdf-12 --test sparql_version` | 3 passed |
| pinned Oxigraph SPARQL conformance lane | pass |
| JavaScript `test/store.test.ts` | 43 passed |
| affected Python store tests | 2 passed |
| `sparql_query_eval` fuzz target | 60 seconds, no crash |
| `sparql_update_eval` fuzz target | 60 seconds, no crash |

The checks prove only the changed product/binding behavior at this source
state. They do not confer production readiness, performance, containment,
provider, or broad semantic-parity claims.

## Acceptance boundary

This ADR's recovery decision is implemented when:

1. upstream `7ce152a1` and the two cross-backend regressions are committed;
2. the proportional R1 gates above pass;
3. ADR-0014 and ADR-0017 are reconciled to this decision;
4. ADRs 0034 through 0041 and both programme plans clearly state their
   non-gating future status;
5. README and the programme Gist describe the implemented write seam and R1
   boundary without a harness-first ETA;
6. Ruflo has one active delivery task, with deferred work no longer marked as
   current execution; and
7. the N3 gitlink is reachable from its declared remote, or the release remains
   explicitly held without claiming clone reproducibility; and
8. the six-hour timer is active and a native `codex queue` service invocation
   has succeeded for the intended persisted thread.

## Consequences

### Positive

- The already-delivered write interface reaches users without waiting for an
  unrelated containment research programme.
- Validation remains strong but follows the changed product surface.
- The detailed harness history stays available without controlling application
  sequencing.
- Progress and blockers become externally auditable against a short gate list.

### Negative

- R1 makes narrower claims than the original all-capabilities programme.
- Dormant harness investment does not produce immediate release value.
- Future containment or broad parity work must be reactivated and justified as
  a separate delivery slice.
- The external scheduler depends on the user-level `systemd` manager, the
  native Codex app server, and this persisted thread remaining available.
- Ruflo currently reports a processed audit in daemon counters without
  reconciling the corresponding MCP worker record to `completed`. The counter
  cannot identify which queued request ran; reviews retain both observations
  and require an attributable result before claiming that exact audit completed.

### Neutral

- RocksDB remains the sole production-intended persistent backend under
  ADR-0042.
- TurboKV remains historical decision evidence and is not active work.
- No qualification baseline, protected receipt, or expected semantic result is
  refreshed by this decision.
