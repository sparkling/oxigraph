# ADR-0026: Service identity and authorization boundary

- **Status**: Proposed
- **Date**: 2026-08-25
- Updated: 2026-08-25
- Deciders: Oxigraph parity programme
- Implementation status: not implemented; planned by G4.1
- Programme task: `task-1787670631989-m5vxqk`
- **Depends on**:
  [ADR-0019 — Unified egress, cancellation, and service claims](0019-unified-egress-cancellation-and-service-claims.md)
- **Related**:
  [ADR-0011 — SPARQL version and protocol semantics](0011-sparql-version-and-protocol-semantics.md),
  [ADR-0017 — Repository evolution and evidence promotion harness](0017-repository-evolution-and-evidence-promotion-harness.md),
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md),
  [ADR-0027 — Workload admission and operator resources](0027-workload-admission-and-operator-resources.md),
  [ADR-0029 — RDF4J REST interoperability](0029-rdf4j-rest-interoperability.md)

## Context

The CLI server currently exposes `/query`, `/update`, `/sparql`, and `/store`
without an authenticated request identity or an authorization decision. Its
default bind is loopback, but binding it elsewhere, enabling CORS, or placing it
behind a proxy does not create an identity boundary. Forwarded routing headers
are also not credentials. The core `Store` is an embeddable dataset and should
not acquire password, token, or web-framework policy concerns merely because
the server needs them.

Jena Fuseki and RDF4J Server demonstrate useful endpoint- and role-oriented
deployment seams. They are comparison systems, not authority for Oxigraph's
API, and neither justifies copying a Java security framework or claiming
fine-grained RDF filtering that this repository has not proved.

## Decision

Add a server-layer identity and authorization pipeline in front of every data,
service-description, compatibility, and operator route. The conceptual API is
split into three values:

- `RequestIdentityProvider` authenticates bounded transport metadata and
  returns an opaque `RequestPrincipal` plus an authentication method and
  policy-relevant, size-bounded attributes;
- `RequestOperation` classifies the requested action as service discovery,
  query, update, graph read, graph write, repository compatibility, health, or
  privileged operation before RDF work starts; and
- `RequestAuthorizer` returns `Allow { policy_id, workload_class }` or a typed
  deny/error. `workload_class` selects only an operator-configured
  ADR-0027 profile and is never accepted directly from the client.

Authentication and authorization run before a request body is buffered or
parsed, a transaction is opened, outbound egress begins, or repository
existence is disclosed. Provider failure, missing required policy, ambiguous
proxy provenance, and policy-evaluation timeout fail closed. Unauthenticated
and authenticated-but-denied requests map consistently to HTTP 401 and 403;
responses must not distinguish a hidden repository or graph from another
denied resource.

The first authorization profile is deliberately coarse: server, configured
repository, endpoint, HTTP operation, and direct Graph Store selector. SPARQL
query/update authorization admits or rejects the complete operation. Rewriting
algebra, filtering result rows, or silently hiding triples is not permitted.
Graph- or triple-level SPARQL policy requires a later decision with leakage,
dataset-selection, inference, `SERVICE`, update, and timing tests.

### Trust and protocol boundary

- The initial providers are explicit anonymous mode for trusted local use and
  a trusted-proxy adapter. A proxy adapter accepts identity headers only from
  configured immediate peers, removes client-supplied copies, validates one
  canonical scheme, and binds issuer/audience and proxy configuration version.
- Native password storage, an OAuth/OIDC issuer, JWT key discovery, API-key
  lifecycle, and TLS termination are not implemented by this ADR. A later
  provider may add one without changing the authorization interface.
- CORS is never authentication. `Forwarded` and `X-Forwarded-*` affect external
  URL construction only when the immediate proxy is trusted; they never name a
  principal by themselves.
- Credentials, tokens, raw identity attributes, query text, and RDF terms are
  not logged or placed in receipts. Audit events use a bounded pseudonymous
  principal reference, request ID, operation, policy version, disposition, and
  reason code. Commit receipts may bind that audit reference through ADR-0020
  without embedding identity material.
- Health may have a separately configured anonymous liveness response.
  Readiness detail and every maintenance action require explicit operator
  authorization; data-plane roles do not imply operator authority.

### Compatibility and non-goals

The Rust `Store`, `TransactionalDataset`, and SPARQL evaluator remain
identity-neutral. Existing loopback deployments retain an explicit open
profile. A non-loopback open profile requires an affirmative unsafe/development
configuration and emits a startup diagnostic; enabling authorization is
otherwise additive. This ADR does not introduce multi-tenancy, row-level
security, data encryption, identity federation, billing, or a multi-repository
control plane.

## Staged implementation and evaluator gates

1. **Identity seam:** freeze compile fixtures for a custom provider and
   authorizer, plus wire tests for anonymous, authenticated, malformed,
   expired, provider-error, and spoofed trusted-proxy requests.
2. **Authorization matrix:** prove every existing route and method is
   classified, denied work opens no transaction and starts no egress, read-only
   mode remains stricter than policy, and 401/403 responses leak no hidden
   resource distinction.
3. **Operator and audit profile:** prove policy reload is an atomic immutable
   snapshot, privileged routes require a separate operation, audit labels and
   fields are bounded, and credentials never appear in errors, logs, metrics,
   or receipts.
4. **Compatibility gates:** run default/RDF-1.2, CORS, Graph Store, SPARQL
   protocol, service-description, and future RDF4J-facade suites with auth off,
   allow, deny, and provider failure. Loopback fixtures replace external
   identity services.

Promotion requires a separate evaluator-only commit, negative tests for every
route, source-compatible embedding fixtures, and an exact configuration and
HTTP-status receipt. No service description may claim authorization support
merely because an identity provider type compiled.

## Consequences

- Deployments gain one inspectable decision point without coupling storage to
  a credential technology.
- Endpoint-level policy is enforceable and testable, while fine-grained RDF
  filtering remains honestly unsupported.
- Trusted-proxy configuration and policy reload become security-critical
  operator responsibilities.
- Denial before parsing reduces unauthorized work but does not replace
  workload and process isolation.

## Alternatives rejected

- **Document a reverse proxy and add no server seam.** Embedders and future
  compatibility routes could bypass policy, and the server could not bind a
  verified principal to admission or audit.
- **Build passwords or OIDC directly into the core store.** Credential
  lifecycle and HTTP transport are not RDF storage responsibilities.
- **Authorize by rewriting SPARQL or filtering returned quads.** That creates
  difficult semantic and side-channel claims without an executable oracle.
- **Trust arbitrary forwarded headers.** A direct client could forge both
  identity and externally visible service URLs.

## Evidence and task ownership

The current unauthenticated route dispatch and proxy-header handling are in
[`main.rs`](../../cli/src/main.rs); Graph Store dispatch is in
[`graph_store.rs`](../../cli/src/graph_store.rs). The first-party comparison
points are [Jena Fuseki's data-access-control
documentation](https://jena.apache.org/documentation/fuseki2/fuseki-data-access-control)
and [RDF4J Server's servlet role
constraints](https://rdf4j.org/documentation/tools/server-workbench/#access-rights-and-security).
This ADR remains Proposed until G4.1's frozen evaluator and implementation
receipts pass.
