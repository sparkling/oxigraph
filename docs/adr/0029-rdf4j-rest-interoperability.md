# ADR-0029: RDF4J REST interoperability

- Status: Proposed
- Date: 2026-08-25
- Updated: 2026-08-25
- Deciders: Oxigraph parity programme
- Implementation status: not implemented; the current server exposes W3C and
  Oxigraph routes, not an RDF4J REST compatibility profile
- Programme task: `task-1787670632568-gk92vo` (G4.4)
- Depends on:
  [ADR-0011 — SPARQL version and protocol semantics](0011-sparql-version-and-protocol-semantics.md),
  [ADR-0014 — End-to-end RDF dataset graph topology](0014-rdf-dataset-graph-topology.md),
  [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md),
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0026 — Service identity and authorization boundary](0026-service-identity-and-authorization.md),
  [ADR-0027 — Workload admission and operator resources](0027-workload-admission-and-operator-resources.md),
  [ADR-0030 — Leased remote HTTP transactions](0030-leased-remote-http-transactions.md)
- Related:
  [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md),
  [ADR-0021 — Transaction-time SHACL validation](0021-transaction-time-shacl-validation.md),
  [ADR-0022 — Operational readiness, backup, and recovery](0022-operational-readiness-backup-and-recovery.md),
  [ADR-0025 — Explicit SERVICE federation](0025-explicit-service-federation.md),
  [ADR-0031 — Multi-repository lifecycle](0031-multi-repository-lifecycle.md)

## Context

Oxigraph's CLI implements SPARQL Query/Update Protocol and Graph Store routes at
`/query`, `/update`, `/sparql`, and `/store`. Eclipse RDF4J's
`HTTPRepository` uses an extended REST protocol rooted at `/repositories`, with
protocol discovery, repository listing, direct statement/context/namespace
operations, size, and leased HTTP transactions. Pointing that client at
Oxigraph therefore does not currently work as an RDF4J repository even where
the underlying RDF operation exists.

The requested outcome is client interoperability for one configured Oxigraph
store. It is not permission to copy RDF4J's Java API, server configuration,
Workbench, storage layout, or multi-repository administration.

## Decision

Add an optional, versioned **single-repository RDF4J REST facade**, disabled by
default and mounted under a configured prefix such as `/rdf4j-server`. One
configured, percent-encoded repository ID maps to the server's existing
`Store`; unknown IDs fail consistently. Existing Oxigraph/W3C routes retain
their paths and semantics.

The first profile targets the protocol-12 wire grammar used by the pinned
RDF4J 6.0.0 `HTTPRepository`, but advertises that protocol from `/protocol`
only after the mandatory client matrix is green. Its endpoint mapping is:

| RDF4J resource | Oxigraph behavior in the first profile |
|---|---|
| `GET /protocol` | Return the receipted protocol number only |
| `GET /repositories` | Return a SPARQL tuple result containing the one configured repository |
| `GET`/`POST /repositories/{id}` | Execute SPARQL queries with RDF4J parameter and content-negotiation rules |
| `/repositories/{id}/statements` | Pattern get/has, SPARQL Update, and RDF add, replace, or remove through an owned transaction |
| `/repositories/{id}/contexts` and `/size` | Return exact context and statement-count views for the requested scope |
| `/repositories/{id}/namespaces[/prefix]` | Use ADR-0020's transactional namespace registry |
| `/repositories/{id}/transactions[/token]` | Translate begin, operation, ping, prepare, commit, rollback, and expiry onto ADR-0030 |

Statement selectors parse RDF4J's N-Triples-encoded `subj`, `pred`, `obj`, and
repeated `context` values. No context parameter means every context; the
literal `null` selects only the default graph. `infer`, `baseURI`, blank-node
preservation, query/update dataset parameters, status codes, `Location`, and
content negotiation are implemented only according to the frozen profile;
unsupported values fail explicitly rather than being ignored or reinterpreted.

ADR-0030 owns the transaction state machine, owned Rust handle, budgets,
expiry, shutdown, commit ambiguity, and outcome lookup. This facade only maps
RDF4J actions and representations onto that state machine. `PREPARE` succeeds
only when the effective backend capability proves it; no protocol response
upgrades a serialized-writer transaction into a stronger guarantee.

The RDF4J client identifies a transaction by the opaque resource URL returned
in `Location`, whereas ADR-0030's native route keeps its secret token out of
the URI. The compatibility adapter therefore treats its random URL segment as
a bearer secret, binds it to the ADR-0026 principal, stores only a verifier,
and maps it internally to the native lease. This compatibility-specific route
requires TLS or a trusted local transport, never enables credentialed CORS,
sets a no-referrer policy, and redacts the complete transaction URL from logs,
metrics, errors, and receipts. The native transaction protocol does not adopt
this URI credential. Canonical URLs trust forwarded host/proto only through
ADR-0026's configured proxy boundary.

### Semantic and format boundary

- Standard RDF and SPARQL-result formats shared by both projects are the first
  codec profile. RDF4J Binary RDF and binary tuple results are separate codec
  work: they are neither accepted nor advertised until independently tested.
- The evaluator must include the unmodified default RDF4J 6.0.0 client. If its
  default request path requires a binary codec, default-client compatibility
  remains open while a separately configured common-format client may form a
  narrower named profile.
- RDF4J contexts do not by themselves carry Oxigraph's explicit empty
  named-graph topology. The facade never deletes or fabricates such graphs
  while serving statement operations. Empty-graph round-trip is unsupported
  unless a protocol extension with an ADR-0014 oracle is separately accepted.
- Inference is not silently mapped to the current simple dataset. A profile
  states whether `infer=true` is supported and by which receipted entailment
  configuration; otherwise it returns a typed protocol error.
- RDF4J repository create/delete/configuration, Workbench, SHACL-specific
  endpoints, multi-repository lifecycle, Binary RDF, and repository file
  compatibility are non-goals of the first profile.

All facade routes pass through the same authorization, admission, body,
deadline, egress, cancellation, metrics, and readiness controls as native
routes. Transaction tokens are credentials and are redacted from logs,
metrics, error bodies, and durable receipts. Browser CORS and CSRF behavior is
explicit; enabling CORS never enables credentialed compatibility operations.

## Staged implementation and evaluator gates

1. **Discovery and read profile:** freeze protocol/list/query, statement
   pattern, contexts, size, status, parameter, and Accept negotiation wire
   fixtures. Differentially compare logical results with a pinned RDF4J Server
   and preserve Oxigraph empty-graph state.
2. **Mutation and namespaces:** prove add/replace/remove, SPARQL Update,
   repeated/default contexts, base IRI, blank nodes, namespace commit/rollback,
   malformed bodies, and custom source errors through owned transactions.
3. **Leased-transaction adapter:** after ADR-0030's native state-model receipt,
   an official `HTTPRepository` client exercises begin, read-your-writes,
   multiple operations, ping, supported prepare, commit, rollback, disconnect,
   cancellation, expiry, wrong principal, URI-token redaction, saturation, and
   shutdown. No abandoned lease publishes data or leaks a writer permit.
4. **Compatibility qualification:** run a hash-pinned RDF4J 6.0.0 Java client
   corpus and independent raw-wire corpus against default/RDF-1.2 and
   read-only/read-write builds. Native SPARQL, Graph Store, topology, auth,
   resource, egress, and transaction regressions remain green.

The receipt records exact RDF4J artifacts, Java/runtime versions, profile and
codec identifiers, endpoint cases, exclusions, and response hashes. Passing a
subset cannot be described as generic “RDF4J compatible,” and `/protocol` is a
fail-closed claim gate rather than a compile-time constant.

## Consequences

- Existing RDF4J client applications gain a bounded migration/integration path
  to one Oxigraph store.
- The facade adds a compatibility adapter and substantial error/negotiation
  matrix without duplicating ADR-0030's lease state machine or changing the
  core RDF model.
- Namespace interoperability waits for ADR-0020; principal fairness and safe
  leases wait for ADR-0026, ADR-0027, and ADR-0030.
- Full RDF4J Server, Workbench, binary formats, and multi-repository parity
  remain explicitly unsupported.

## Alternatives rejected

- **Alias `/repositories/{id}` directly to `/sparql`.** Discovery, statements,
  contexts, namespaces, size, and transaction behavior would still be wrong.
- **Claim compatibility from curl examples.** The real target is the pinned
  official client plus an independent wire oracle.
- **Implement repository administration with the facade.** Lifecycle, paths,
  deletion, configuration, and privilege boundaries require a separate
  multi-repository decision.
- **Silently map unsupported inference, binary formats, or empty graphs.** That
  would trade interoperability errors for data or semantic loss.

## Evidence and task ownership

The existing routes are in [`main.rs`](../../cli/src/main.rs) and
[`graph_store.rs`](../../cli/src/graph_store.rs). The comparison authority is
the [RDF4J REST documentation](https://rdf4j.org/documentation/reference/rest-api/),
the version and resource constants in [RDF4J 6.0.0
`Protocol.java`](https://github.com/eclipse-rdf4j/rdf4j/blob/6.0.0/core/http/protocol/src/main/java/org/eclipse/rdf4j/http/protocol/Protocol.java),
and the official [`HTTPRepository` client
contract](https://rdf4j.org/documentation/programming/repository/#access-over-http).
This ADR remains Proposed until G4.4's separate evaluator and exact client/wire
receipt exist.
