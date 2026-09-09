# ADR-0026: Service identity and authorization boundary

- **Status**: Proposed
- **Date**: 2026-08-25
- Updated: 2026-09-09
- Deciders: Oxigraph parity programme
- Implementation status: anonymous listener startup and pre-body transport admission implemented;
  request identity, coarse authorization, proxy trust and audit/reload remain G4.1
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

### Native anonymous listener slice (2026-09-09)

`serve` and `serve-read-only` now resolve the configured address once, validate
the whole resolved set before store open or listener startup, and bind exactly
those validated sockets. Anonymous non-loopback listening requires the explicit
`--unsafe-allow-remote-anonymous` development option and emits a warning.
Wildcard, mixed DNS and IPv4-mapped IPv6 addresses do not bypass this rule.
The Docker default is loopback too; the CLI README documents explicit container
opt-in and its remaining network exposure. No new dependency is introduced.

Native tests cover IPv4/IPv6 loopback, wildcard/non-loopback/mixed/empty sets,
single resolution retention, both command paths rejecting before store open,
and explicit consent/warning. Existing loopback wire tests retain ordinary
HTTP behavior. This implements the compatibility/open-profile requirement,
**not** authentication, request authorization, trusted proxy support, audit,
policy reload or G4.1 completion. There is no authorization advertisement.

### Native transport admission slice (2026-09-09)

The existing OxHTTP 0.3.3 dependency is now source-vendored at `lib/oxhttp`,
with its licenses, upstream tests and exact origin recorded in `UPSTREAM.md`.
Its upstream handler ran after body decoding and lacked socket context, so it
could not implement the required trusted-immediate-peer/pre-body boundary.
The narrow fork provides immutable socket-derived `ConnectionInfo` in request
extensions and optional `Server::with_request_admission`. Admission receives
an immutable bounded request head and returns trusted extensions or a rejection.
It runs on every keep-alive request before `100 Continue`, body decoding,
draining or application dispatch. Denial closes with a transport-owned
`Connection: close`; informational denials become an empty HTTP 500.
Returned extensions cannot replace the actual socket provenance.

The upstream 8 KiB header limit and 16 KiB transport buffer remain unchanged.
Header reads can prefetch body bytes; the guarantee is before **body decoding
and application buffering**, not zero socket read-ahead. The immutable head
prevents admission from changing framing. The later application wrapper must
strip identity/forwarding headers before business handling; this hook does not
authenticate them. The no-hook encoder and parser/client behavior are retained.
No additional HTTP framework or default-runtime dependency is introduced;
workspace lock resolution includes the existing optional AWS-LC feature.

Native wire tests prove no-body/eager-body/invalid-framing denials, Expect
ordering, fresh keep-alive admission, socket/context propagation and spoof
resistance, and rejection of malformed/oversized headers before admission.
Unchanged upstream wire and codec tests remain the compatibility checks.
This closes the transport prerequisite, not the remaining G4.1 identity,
authorizer, audit/reload or promotion gates. No authorization is advertised.

### Remaining gates

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
