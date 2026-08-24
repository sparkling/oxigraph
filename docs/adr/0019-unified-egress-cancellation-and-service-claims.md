# ADR-0019: Unified egress, cancellation, and service claims

- Status: Proposed
- Date: 2026-08-24
- Updated: 2026-08-24
- Deciders: Oxigraph parity programme
- Implementation status: not implemented; planned by G1.5-G1.6
- Depends on:
  [ADR-0018 — Transaction guarantees and conflict model](0018-transaction-guarantees-and-conflict-model.md)
- Related:
  [ADR-0011 — SPARQL version and protocol semantics](0011-sparql-version-and-protocol-semantics.md),
  [ADR-0016 — Backend-neutral transactional RDF writes](0016-backend-neutral-transactional-writes.md),
  [ADR-0025 — Explicit SERVICE federation](0025-explicit-service-federation.md)

## Context

Query evaluation already accepts service handlers and a cancellation token,
and the built-in HTTP client has time and redirect limits. SPARQL `LOAD`,
default `SERVICE`, and remote document/JSON-LD context egress are nevertheless
assembled through different paths, and update mutation loops do not share one
end-to-end cancellation contract.
There is no single policy for schemes, destinations, DNS changes, redirects,
response size, or connection budgets.

The CLI service description is intentionally conservative under ADR-0011.
Future disclosure must reflect effective runtime behavior, not compile-time
features or aspirational parity.

## Decision

Route every built-in remote `SERVICE`, `LOAD`, and document-loader request
through one egress-policy capability. The policy validates schemes, hosts,
resolved addresses, redirects, byte limits, time budgets, and connection
budgets. It revalidates every DNS resolution and redirect and can deny private,
loopback, link-local, or otherwise disallowed destinations. Custom handlers
remain possible, but their use is an explicit capability boundary rather than
an implicit bypass of the built-in policy.
Compressed and decoded byte limits are separate. URL credentials, cookies,
and authorization headers are never forwarded across origins implicitly. File
access is a different explicit capability; an HTTP allow rule does not
authorize `file:`. Server profiles default to no built-in network egress until
a reviewed policy enables it.

Thread one cancellation/deadline context through query algebra, remote body
reads, update loops, document parsing, staging, and writer-gate acquisition.
Cancellation before `CommitAttempted` rolls the complete request back.
Cancellation after that transition follows ADR-0018 and ADR-0020 and may
return an indeterminate transaction key; it may not claim rollback without
proof.

Generate service descriptions from effective runtime capabilities and closed
receipts. A disabled, policy-blocked, untested, or unavailable capability is
not advertised. ADR-0011's conservative SPARQL 1.0/1.1 disclosure remains the
baseline until richer claims have exact endpoint evidence.

## Acceptance boundary

This ADR remains Proposed until G1.5-G1.6 prove:

- loopback fixtures for allowed and denied targets, DNS rebinding, redirects,
  cross-origin credentials, partial/compressed streams, response limits,
  timeouts, and connection failures;
- the same policy is reached by built-in `SERVICE` and `LOAD` paths;
- remote document and JSON-LD context loading cannot bypass the policy;
- cancellation during every update phase leaves no partial primary state;
- error variants distinguish policy denial, timeout, cancellation, remote
  failure, conflict, and indeterminate commit;
- every advertised service-description feature has a closed endpoint receipt;
  and
- query text, RDF payloads, credentials, IRIs, and user identifiers are absent
  from default telemetry.

## Consequences

- Server operators get one reviewable outbound security boundary.
- Query and update cancellation acquire consistent transaction semantics.
- Runtime profiles may advertise different capabilities without lying about a
  disabled feature.
- Existing callers relying on unrestricted built-in egress may need an
  explicit policy configuration.

## Alternatives rejected

- **Keep `SERVICE` and `LOAD` policy separate.** Redirect and cancellation
  fixes would remain bypassable through the other path.
- **Derive claims from Cargo features.** Compilation does not prove runtime
  policy, availability, or endpoint behavior.
- **Treat timeout as cancellation.** A timeout source and the transaction's
  durable outcome are separate facts.

## Evidence and task ownership

Current boundaries are visible in
[`sparql/http.rs`](../../lib/oxigraph/src/sparql/http.rs),
[`http.rs`](../../lib/oxigraph/src/http.rs),
[`sparql/update.rs`](../../lib/oxigraph/src/sparql/update.rs), and
[`service_description.rs`](../../cli/src/service_description.rs). G1.5-G1.6
own delivery in the
[linked-data-store evolution plan](../plans/linked-data-store-evolution-harness-plan.md).
