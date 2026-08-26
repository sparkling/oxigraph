# ADR-0025: Explicit SERVICE federation

- **Status**: Proposed
- **Date**: 2026-08-24
- Updated: 2026-08-26
- Deciders: Oxigraph parity programme
- Implementation status: not implemented; planned by G3.5. G1.6 has satisfied
  the runtime-derived service-claim prerequisite, but no federation planner or
  endpoint catalog has been implemented
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

G3.5 research may begin after G1.5 and G3.1-G3.2. G1.6 closed the
runtime-derived service-claim prerequisite on 2026-08-26: the server suppresses
federation and remote-input claims under its shared deny-all evaluator, while
capability-enabled evaluators disclose only their effective configured and
compiled capability snapshot. That snapshot is not remote endpoint health or
current request admission. G3.5 remains Proposed and must still use controlled
loopback endpoints to prove:

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
