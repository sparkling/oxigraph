# ADR-0029: RDF4J REST interoperability

- **Status**: Proposed
- **Date**: 2026-08-25
- Updated: 2026-08-25
- Deciders: Oxigraph parity programme
- Implementation status: not implemented; the current server exposes W3C and
  Oxigraph routes, not an RDF4J REST compatibility profile
- Programme task: `task-1787670632568-gk92vo` (G4.4)
- **Depends on**:
  [ADR-0011 — SPARQL version and protocol semantics](0011-sparql-version-and-protocol-semantics.md),
  [ADR-0014 — End-to-end RDF dataset graph topology](0014-rdf-dataset-graph-topology.md),
  [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md),
  [ADR-0020 — Transactional metadata, receipts, and change delivery](0020-transactional-metadata-receipts-and-change-delivery.md),
  [ADR-0026 — Service identity and authorization boundary](0026-service-identity-and-authorization.md),
  [ADR-0027 — Workload admission and operator resources](0027-workload-admission-and-operator-resources.md),
  [ADR-0030 — Leased remote HTTP transactions](0030-leased-remote-http-transactions.md)
- **Related**:
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

### Concrete scoping for the smallest stage-1 slice, and why it is not implemented this session (2026-09-17)

With this session's own two crash-test audit forks closed (ENOSPC and
real-process-kill, both ADR-0028) and G4.2 (ADR-0027) audited and found not to
be a good single-tick fit (its own remaining items are either brand-new
zero-code feature slices or a separate evaluator-authority track), this ADR's
own dependency-clear stages 1-2 were investigated as the next candidate. Stage
3 (the leased-transaction adapter) explicitly depends on ADR-0030/G4.5, which
is 0% done; stages 1 and 2 use Oxigraph's own existing transaction mechanism
and are genuinely dependency-clear, confirmed by reading this ADR's own
"Staged implementation and evaluator gates" section directly rather than
trusting an earlier session's "unblocked" note.

No existing scaffolding exists anywhere in the repository: a case-insensitive
search for "rdf4j" across every source file matches only documentation (this
ADR, the plans, the README); zero `.rs` files reference it. This is a clean
slate.

The routing architecture was read directly to find the smallest defensible
first slice. Every native HTTP route dispatches from one flat
`match (request.uri().path(), request.method().as_ref())` block inside
`handle_request` (`cli/src/main.rs`). The layers this ADR requires new facade
routes to inherit -- authorization, admission, deadline, egress, cancellation,
metrics, and readiness -- are applied structurally *outside and before* that
match, in `serve`'s own request-handling closure (`AccessController::
prepare_request` -> `operations::gate` (readiness) -> `check_request` ->
`handle_request` -> `finalize_response`, with admission wired at the
connection level via `Server::with_request_admission`). A new match arm
therefore inherits every one of those controls automatically, with no new
middleware plumbing -- confirmed by reading the code, not assumed from the
ADR's own "all facade routes pass through the same ... controls as native
routes" claim.

`GET /repositories` -- "return a SPARQL tuple result containing the one
configured repository" per this ADR's own endpoint table -- is the smallest
defensible first route: no RDF4J-specific request parsing, no
transaction/mutation semantics, and no exposure to ADR-0030/G4.5 at all
(unlike `/protocol`, whose own pre-qualification response this ADR leaves
genuinely unspecified: it says `/protocol` advertises the real protocol
number only "after the mandatory client matrix is green," but never states
what it should return before that point). The response itself is tractable
with existing library primitives: `spareval::QuerySolutionIter::from_tuples`
builds a synthetic one-row tuple result from a fixed variable list with no
real SPARQL evaluation needed, and the existing `query_results_content_
negotiation` helper (`cli/src/main.rs`, already used by `/query`) already
implements the exact JSON/XML/CSV/TSV Accept-header negotiation this ADR's
own stage-1 gate names as a requirement, so no new negotiation code is
needed either.

This is not implemented this session, for two honestly-stated reasons rather
than time pressure alone:

1. **Genuine scope, once traced end to end.** Wiring even this single route
   correctly touches: a new CLI flag on *two* command variants (`Serve` and
   `ServeReadOnly` both call the shared `serve` function, each with its own
   `#[arg(long)]` in `cli/src/cli.rs`); both of `main`'s own dispatch match
   arms; `serve`'s and `handle_request`'s own signatures; and a genuinely new
   response-construction path. This is a larger, more novel unit of work than
   any single crash-test increment this session completed (each of those
   reused an existing test-scaffolding pattern almost entirely; this reuses
   library primitives but the wiring itself is new). Attempting to write,
   self-verify, and get this independently reviewed inside the tail of an
   already investigation-heavy tick risked exactly the kind of rushed,
   lower-quality first cut this session has consistently avoided elsewhere.
2. **The exact RDF4J wire-format column names for `/repositories` are not
   verifiable against anything in this repository.** This ADR itself does not
   specify them (only "a SPARQL tuple result containing the one configured
   repository"), and no pinned RDF4J reference, fixture, or client corpus
   exists anywhere in the tree to check against -- confirmed by the same
   repository-wide search that found no existing scaffolding. This ADR's own
   stage-1 gate requires "differentially compar[ing] logical results with a
   pinned RDF4J Server" before this can be called verified, which is not
   something an ordinary-delivery increment in this environment can satisfy
   on its own. Implementing a best-effort guess at the column names (the
   real, stable, publicly-documented RDF4J protocol uses `id`/`title`/`uri`/
   `readable`/`writable`) without a way to verify it here would be exactly
   the kind of unqualified claim this ADR's own closing paragraph warns
   against ("Passing a subset cannot be described as generic 'RDF4J
   compatible'").

This scoping is recorded so a future session can start implementation
directly from it rather than re-deriving the routing/reuse analysis: the
exact file locations, the exact library primitives to reuse, and the exact
two open risks (implementation scope, wire-format verification) to resolve
before or during that work.

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
