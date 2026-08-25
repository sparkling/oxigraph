# ADR-0019: Unified egress, cancellation, and service claims

- Status: Proposed
- Date: 2026-08-24
- Updated: 2026-08-25
- Deciders: Oxigraph parity programme
- Implementation status: G1.5's unified-egress profile is implemented and
  source-bound; end-to-end mutation cancellation and G1.6 runtime-derived
  service claims remain outstanding
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
[`service_description.rs`](../../cli/src/service_description.rs).

G1.5's unified-egress profile is implemented by product commits `e452bad1` and
`3f4cdfd7`. Built-in `SERVICE`, `LOAD`, and nested document retrieval share an
explicit egress policy; the governed profile denies by default, applies
conjunctive origin/address admission, rejects credentials and redirects, keeps
encoded and decoded response limits separate, shares a connection budget, and
returns typed policy, timeout, cancellation, remote, and budget failures.
Cancellation while reading a remote `LOAD` response rolls back its staged
update, and terminal response paths close the body before releasing admission.

The evaluator-only commit is
`f1fa7900191a4eaffd2d9c92694851152a5e4fb1`, with tree
`829b42c96c6bf72839f7858c6da932c8709d2d60`, evaluator blob
`fea9d5a25e680ff30d27592139152b85e0852581`, content SHA-256
`96a414d1ccf78e323e310a853ca6f1c060567c44b02b688b8de523a0ebf61e87`,
and evaluator patch SHA-256
`aacc284628b9bb64073a97eee29c555fef327c23cd169cf15ea2e1d1e1d9ee91`.
The frozen contract digest is
`e77e11a02e55e995583f0bab118878a42c490b562e0826c6b1611db096c6dfec`.
It retained 1,382 protected entries with manifest SHA-256
`5f7c03cef435fd8ed8750b6ce13f8807481413e75dc1b943dbc118fdd9ccda30`.

The engineering harness reconstructed exact product patch
`88ba98acece42a0dc595c9b44951de90fe7f0c2a0c33c3f6bf0cad95ff36c3cc`
as candidate commit `dce82860d028d675471b6990127d143a66144e82` and tree
`ee4562f93bfa8558a931806bc4d8934df187506f`. The isolated verifier returned
`ACCEPT` after format, build, 12 public egress-policy tests, 8 independent
`LOAD` tests, and 13 `SERVICE` regressions in 308.871 seconds. Its
`verifier-session-result.json` was 112,685 bytes with SHA-256
`4d1f9df209046b439db07346a22f2b4c9063f80b913d2a752abcc7a1123234eb`.

This receipt proves the frozen remote-egress profile only. It does not prove
cancellation through every non-remote mutation loop, staging phase, or writer
gate after admission, and it does not close G1.6's runtime service-description
claims. ADR-0019 therefore remains Proposed. G1.5's remaining cancellation
boundary and G1.6 own completion in the
[linked-data-store evolution plan](../plans/linked-data-store-evolution-harness-plan.md).
