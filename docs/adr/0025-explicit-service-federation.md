# ADR-0025: Explicit SERVICE federation

- **Status**: Proposed
- **Date**: 2026-08-24
- Updated: 2026-09-23 — first G3.5 telemetry slice delivered (`75b3cc80`,
  opt-in HTTP SERVICE execution observations) and accepted by independent review
  `690ae0dc`; the stale "no loopback fixtures" statement corrected. Still
  Proposed; no planner or catalog.
- Deciders: Oxigraph parity programme
- Implementation status: partially implemented. Opt-in HTTP SERVICE execution
  observations are delivered by `75b3cc80`. G1.6 has satisfied the
  runtime-derived service-claim prerequisite for later advertisement, but no
  federation planner, endpoint catalog, source selection or bound batching has
  been implemented
- **Depends on**:
  [ADR-0019 — Unified egress, cancellation, and service claims](0019-unified-egress-cancellation-and-service-claims.md),
  [ADR-0023 — Statistics and bounded join planning](0023-statistics-and-bounded-join-planning.md)
- **Related**:
  [ADR-0011 — SPARQL version and protocol semantics](0011-sparql-version-and-protocol-semantics.md),
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0026 — Service identity and authorization boundary](0026-service-identity-and-authorization.md),
  [ADR-0027 — Workload admission and operator resources](0027-workload-admission-and-operator-resources.md)

## Context

The evaluator supports explicit SPARQL `SERVICE` through registered and default
handlers. It does not maintain an endpoint catalog, select sources, plan bound
joins across endpoints, or expose federated request/row estimates. Adding
those behaviors before egress policy and statistics would make remote work
unbounded and its failures difficult to interpret.

Useful Jena and RDF4J/FedX behaviors are comparison points, not a reason to
copy Java APIs or silently turn local triple patterns into remote queries.

## Decision

Add planning only for explicit `SERVICE` clauses. The planner consumes a
versioned endpoint catalog containing declared capabilities and cost evidence
to order eligible work and choose bounded joins. Catalog membership is neither
source authority nor authorization, and the planner performs no implicit
network probing. Every request passes through
ADR-0019's egress, deadline, byte, concurrency, and cancellation policy.
A fixed `SERVICE <iri>` targets only that IRI; a variable `SERVICE ?service`
uses endpoints supplied by query bindings. The planner never invents an
endpoint or treats catalog membership as network authorization. ADR-0026
supplies principal/authorization context, while ADR-0027 supplies resource
admission; neither is inferred from catalog metadata.

The embedded/research planner may be implemented after G1.5 and G3.1-G3.2.
Advertising federation additionally requires G1.6's runtime-derived claim
boundary. Exposing it through the server or promoting that profile additionally
requires G4.1 identity/authorization and G4.2 workload admission. An embedded
prototype cannot silently acquire server or promotion authority.

Plans expose endpoint choices, estimated and actual rows, request counts,
bytes, timeouts, and fallback reasons with bounded, payload-free telemetry.
Remote streams are treated as untrusted and resource-bounded. Existing SPARQL
error and `SERVICE SILENT` semantics remain the correctness oracle; planning
may change work and performance, never visible results or error disposition.
Bound-join batching must also preserve duplicate multiplicity, per-invocation
blank-node scope, lazy error behavior, and atomic `SERVICE SILENT` fallback.
When a bounded buffer cannot prove that equivalence, batching is disabled.

Transparent implicit federation, endpoint discovery from arbitrary data,
cross-endpoint updates, distributed transactions, and cross-node failover are
separate product decisions and are not introduced by this ADR. Future
capability probing also requires its own egress- and identity-aware decision.

## Acceptance boundary

G3.5 embedded research and implementation may begin after G1.5 and G3.1-G3.2.
Advertisement additionally requires G1.6; server exposure or promotion also
requires G4.1 and G4.2. G1.6 closed only the runtime-derived service-claim
prerequisite on 2026-08-26: the server suppresses federation and remote-input
claims under its shared deny-all evaluator, while capability-enabled evaluators
disclose only their effective configured and compiled capability snapshot.
That snapshot is not remote endpoint health, authorization, or current request
admission. G3.5 remains Proposed and must still use controlled loopback
endpoints to prove:

- source selection and bound joins return the same results as the unplanned
  explicit-`SERVICE` oracle;
- timeout, denial, partial stream, malformed response, cancellation, and
  `SERVICE SILENT` preserve specified disposition;
- endpoint, request, byte, concurrency, and total-deadline budgets cannot be
  bypassed by redirects or plan alternatives;
- stale or absent catalog/statistics selects a correct deterministic fallback;
- FedShop and local failure corpora record requests, bytes, latency, rows, and
  per-query tails on pinned revisions; and
- no broader service-description claim appears before its endpoint receipts
  close.

## Consequences

- Explicit federation gains bounded, observable optimization.
- Correctness remains testable against today's handler-based evaluator.
- Catalog and statistics freshness become operational dependencies.
- Federation cannot be used as an implicit multi-repository abstraction.

## Alternatives rejected

- **Plan implicit federation first.** It changes query meaning and source
  authority without an explicit user request.
- **Optimize remote work before egress and statistics.** The planner would
  lack both a security boundary and evidence-based costs.
- **Adopt FedX or ARQ APIs verbatim.** Observable outcomes are useful; their
  Java extension hierarchies are not this Rust store's contract.

## Evidence and task ownership

The current handler boundary is
[`service.rs`](../../lib/spareval/src/service.rs), with evaluation in
[`eval.rs`](../../lib/spareval/src/eval.rs). G3.5 owns delivery in the
[linked-data-store evolution plan](../plans/linked-data-store-evolution-harness-plan.md).
G1.6's accepted verifier and rejecting controls satisfy only this ADR's
service-claim prerequisite; they do not implement endpoint selection,
bound-join planning, federation telemetry, or the G3.5 evaluator.

### Scoping investigation: dependencies are satisfied, but the only small slice is not a good single-tick fit (2026-09-18)

Investigated as the next candidate after G4.4's `/rdf4j-server/repositories`
slice landed. This ADR's own acceptance boundary states the embedded/research
planner "may be implemented after G1.5 and G3.1-G3.2." Checked directly rather
than trusted from a plan-doc summary line: ADR-0019's egress/deadline/
cancellation policy is real and live, wrapping every outbound `SERVICE`
request via `HttpClient`/`find_egress_error`; ADR-0023's
`lib/oxigraph/src/sparql/statistics.rs` has a real, non-stub
`StatisticsAvailability`/`BoundStatisticsSparqlQuery` provider. Both
dependencies are genuinely satisfied for embedded/research use.

The codebase check found this is not greenfield, and materially stronger than
expected: `lib/oxigraph/src/sparql/http.rs`'s `HttpServiceHandler` is a
complete, real, egress-policy-respecting HTTP dispatcher for explicit
`SERVICE <iri>` -- it already negotiates content types, parses results, and
correctly distinguishes a fatal deadline from a `SERVICE SILENT`-preserving
remote timeout. `lib/oxigraph/src/sparql/mod.rs` already wires it as the
*default* handler for ordinary query evaluation, so arbitrary explicit
`SERVICE` calls already work end-to-end through `Store` and the CLI today.
This existing handler is exactly the "unplanned explicit-`SERVICE` oracle"
this ADR's own acceptance boundary names as the correctness baseline new
planning work must match -- it already exists in production code, not only
in doc-comment examples.

What this ADR actually still needs breaks into two very different sizes:

1. **A versioned endpoint catalog type** (capabilities and cost evidence,
   keyed by endpoint IRI) -- small, standalone, and zero-risk to existing
   code, since nothing would consume it yet.
2. **Cost-based source selection, bound-join batching, and telemetry wired
   into live query planning** -- large, correctness-critical work touching
   the same join planner/optimizer that decides evaluation order for every
   query today, unlike G4.4's independent new HTTP route.

Only (1) is small enough for a single tick, but implementing it alone this
session is declined for the same reason G4.2's own remaining items were
found not to be a good single-tick fit: it would be genuinely unverifiable
scaffolding. G4.4's `/repositories` route had an external oracle to check a
design choice against even without an in-repo pin (RDF4J's own real source,
fetched directly). A federation catalog's "capabilities" and "cost evidence"
fields have no such oracle -- this ADR states only the phrase, not a schema
-- and no consumer exists yet to validate the shape against either. Building
it now risks inventing a wrong shape that the eventual planner work (2) would
then have to discover was wrong and rework, which is worse than not building
it yet. This is not the same failure mode as "brand-new zero-code feature
slice" (G4.2's finding) but reaches the same conclusion: decline rather than
manufacture unverifiable scaffolding.

No FedShop or controlled-loopback test fixtures exist anywhere in this
repository (checked by search, not assumed), which will also gate this ADR's
own acceptance boundary regardless of when planning work begins.

Corrected 2026-09-23: the fixture half of that statement is no longer true.
`lib/oxigraph/tests/sparql_service_http.rs` and its `support.rs` and
`variable_service.rs` modules now provide real controlled-loopback endpoints
that record the requests they serve, together with version and media-type
negotiation, ordinary and `SILENT` HTTP failures, remote timeout, variable
endpoints and per-response blank-node scope. No FedShop pin or G3.5 planning
corpus exists yet, so that half still stands.

G3.5 remains at 0% progress on the task board; this is accurate, not stale --
genuinely no delivery work has landed toward it. (Superseded 2026-09-23: see
the delivered telemetry slice below.) This scoping is recorded so
a future session does not have to re-derive that `HttpServiceHandler` already
exists and already serves as the correctness oracle, or re-discover why the
catalog-alone slice was declined.

## Delivered: opt-in HTTP SERVICE execution observations (2026-09-23)

Commit `75b3cc80` delivers the first G3.5 slice, built to the prepared contract
in `target/engineering-delivery/g35-planning/coordinator-g35-next-task.md`. It
gives an embedded caller a measurement of what the built-in HTTP `SERVICE`
handler actually did, which later request-reduction work needs as its
consumer-side baseline. It is not an endpoint catalog, a join planner, source
selection or bound batching, and it makes no estimate or endpoint-choice claim.
Its fixed execution profile is `unplanned-http-v1`.

`HttpServiceObservation::new(retained_attempt_limit)` accepts 0 to 1024 retained
records. `SparqlEvaluator::with_http_service_observation` attaches it, and
`snapshot()` reports logical attempts, admitted HTTP-client dispatches, decoded
bytes delivered to the results parser, parsed rows, and completed, failed,
abandoned and in-progress counts, each with a saturation flag. It also reports
bounded per-invocation records and a count of records omitted by the cap. The
observer travels on the existing `HttpClient`, counts only `SERVICE` egress,
and never changes query results, headers, retries or blank-node labels. It
keeps no endpoint IRI, query text, RDF term, credential or error text, which
preserves ADR-0019's payload-free telemetry boundary.

One finding about existing behaviour: spareval dispatches a `SERVICE` when the
query is executed, before the first solution is polled. This was confirmed on
unmodified source and is unchanged by the slice. So an observation taken right
after `execute()` can already show one attempt, in progress.

Verified at `75b3cc80` on a clean tree through the delivery harness:
- The independent oracle `federation_observation` passes 16 tests in each
  feature configuration (`run-99EeoR`, `run-LxRJ4R`).
- The existing service, egress-policy and capability suites pass 10, 13, 12 and
  4 (`run-EFTUUJ`, `run-IhJB8k`, `run-ZOlwBM`, `run-totBWE`).
- The library passes 58 (`run-s7oNDg`).
- The handler-rebinding and no-default-features builds compile (`run-gzmZhR`,
  `run-GnGcnD`).
- Clippy reports no new diagnostics against a same-source baseline without the
  change (`run-7OIKnb` 112 and `run-Ey2Czx` 94, equal to the baselines).

Independent Opus/high review (session `690ae0dc-4cbb-4d22-87f9-ffe6602b2cd4`)
returned **ACCEPT** with no blocking issues. It checked the terminal-state
machine against its failure modes, that no drain or retention occurs, the
privacy boundary, purpose scoping, locking, and all eleven receipts.
Non-blocking notes carried forward:

- The two Clippy baselines are plain-cargo logs, not harness receipts. They
  were taken at the parent commit `9169748e`, recorded in `frozen-head.txt`,
  and hashed under `target/engineering-delivery/g35-observation/`.
- The corrected pre-poll oracle assertion tolerates zero or one attempts
  before the first poll. It is weaker in form than the original, which asserted
  behaviour spareval never had.
- Criterion 8's statistics, text and spatial handler-rebinding legs are covered
  by inspection plus compilation, as the contract allows, not by a runtime test.
- Per-record dispatch, byte and row counts have no saturation flag; only the
  snapshot totals do, which is what the contract requires.
- The pre-existing error text `"No valid SPARQL solutions returned by
  {service_name}"` in `sparql/http.rs` is a plain literal, so the placeholder is
  emitted verbatim. This is upstream behaviour, not introduced here, and
  belongs in a separate cleanup.

This ADR stays **Proposed**. The federation planner, endpoint catalog, source
selection, bound batching, and per-endpoint reports remain undelivered G3.5
work. Each needs its own semantic proof against this baseline. Nothing here
grants server, advertisement, qualification or default-promotion authority.
