# ADR-0011: SPARQL VERSION and protocol semantics

- Status: Accepted
- Date: 2026-07-27
- Updated: 2026-08-24
- Deciders: Oxigraph parity programme
- Implementation status: implemented for version selection and conservative
  endpoint advertisement
- Update note: restored exact SPARQL 1.0/1.1 service-description claims after
  an RDF 1.2 feature build was found advertising unreceipted draft families.
- Related:
  [ADR-0003 — W3C 1.2 conformance baseline](0003-w3c-12-conformance-baseline.md),
  [ADR-0006 — W3C-first 1.2 parity](0006-w3c-first-12-parity.md)

## Context

SPARQL 1.2 introduces an in-band `VERSION` declaration while Oxigraph also
needs an out-of-band mode for embedded parsers and endpoints. Treating the
configured mode as stronger than the operation would ignore the declaration.
Treating a parser feature as complete SPARQL 1.2 support would overstate the
separate Query, Update, Protocol, Graph Store Protocol, Service Description,
result-format, federation, and entailment obligations.

The evolving grammar permits repeated version declarations. Evaluation also
has to preserve the selected RDF term model: parsing a query in one mode and
evaluating it in another would make triple-term behavior depend on the call
path.

## Decision

Expose three explicit parser and evaluator feature modes:

| Mode | Meaning |
|---|---|
| `1.1` | Reject syntax and RDF terms reserved to SPARQL 1.2 |
| `1.2-basic` | Permit the selected 1.2 feature set without triple terms |
| `1.2` | Permit the selected 1.2 feature set including triple terms |

These are feature modes, not family-conformance labels.

`SparqlParser::with_version` and `SparqlEvaluator::with_version` configure the
out-of-band fallback. An in-band `VERSION` declaration is authoritative when
present. Parsed query and update values retain both the declared and effective
versions, and the evaluator uses the effective version.

When an operation contains repeated declarations, use the strongest declared
requirement, independent of order. An unknown or build-disabled mode is a
typed syntax error. Mode validation ignores version-like text inside comments,
strings, and IRIs. An invalid RDF 1.2 update returns an error rather than
panicking.

Evaluation enforces the selected term model as well as syntax. In particular,
a 1.1-mode store operation fails on an RDF 1.2 triple term instead of silently
accepting it through a 1.2-enabled build.

## Endpoint and advertisement policy

Parser capability does not authorize a SPARQL 1.2 protocol claim. Until the
applicable HTTP, Service Description, results, federation, entailment, and
Graph Store Protocol obligations have closed receipts, the CLI service
description advertises only the established SPARQL 1.1 query and update
languages. It does not advertise draft `SPARQLQuery`, `SPARQLUpdate`, or
`supportedVersion` 1.2 values.

An endpoint may select an out-of-band fallback for an operation with no
declaration. It must not override a valid in-band declaration. Content
negotiation, request parameter precedence, status codes, dataset selection,
and graph-store mutation remain separate protocol requirements.

## Evidence

- [SPARQL version implementation](../../lib/spargebra/src/version.rs)
- [Parser version tests](../../lib/spargebra/src/version_tests.rs)
- [Evaluator/store term-mode test](../../lib/oxigraph/tests/sparql_version.rs)
- [Conservative service-description tests](../../cli/src/service_description.rs)
- 19 parser package tests in the SPARQL 1.2 feature lane
- 269 of 269 cases at the pinned official SPARQL 1.2 test revision

The official-suite result is bounded evidence for its manifest. It does not
cover the complete protocol and service surfaces listed above.

## Consequences

- An operation's declared requirement cannot be weakened by endpoint
  configuration.
- Repeated declarations are deterministic and order-independent.
- Parser and evaluator use one recorded term mode.
- A 1.2-enabled build does not automatically advertise SPARQL 1.2
  conformance.
- Closing the protocol surfaces requires independent fixtures and receipts.

## Alternatives rejected

- Let configuration override `VERSION`: contradicts the in-band requirement.
- Let the last declaration win: makes equivalent prologues order-dependent.
- Parse in 1.2 and downgrade only during evaluation: accepts invalid syntax too
  early and loses metadata.
- Advertise SPARQL 1.2 from a feature flag: conflates grammar support with
  family and protocol conformance.

## Acceptance boundary

This decision establishes version-selection precedence, metadata retention,
selected syntax/term-mode enforcement, typed failure, and conservative
advertisement. It does not establish SPARQL 1.2 family parity, Protocol or
Graph Store Protocol conformance, complete Service Description support, or
cross-format result conformance.
