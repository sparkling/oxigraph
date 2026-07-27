# ADR-0010: Bounded RDF Dataset Canonicalization 1.0

- Status: Accepted
- Date: 2026-07-26
- Deciders: Oxigraph parity programme
- Implementation status: implemented and qualified against the pinned W3C suite
- Related:
  [ADR-0003 — W3C 1.2 conformance baseline](0003-w3c-12-conformance-baseline.md),
  [ADR-0005 — Agentic-QE integration](0005-agentic-qe-integration.md)

## Context

RDF Dataset Canonicalization 1.0 (RDFC-1.0) is a supporting W3C
Recommendation, not part of RDF 1.2. Its Hash N-Degree Quads algorithm can
perform factorial work on adversarial datasets. The W3C test suite includes a
poison dataset whose correct outcome is a bounded-work error.

The previous evaluator accepted every negative canonicalization test without
executing the algorithm. The implementation also eagerly materialized all
permutations and exposed only an infallible API. That combination could report
a false conformance pass and allowed untrusted input to consume unbounded time
and memory.

## Decision

Make graph and dataset canonicalization fallible and atomic.

- `canonicalize` applies a default linear Hash N-Degree Quads call budget for
  every canonicalization algorithm.
- Explicit call-limit and work-factor APIs allow trusted callers to choose a
  different bound.
- Work factor zero permits no Hash N-Degree Quads calls; factor one is linear
  in the number of non-unique blank nodes; higher factors deliberately permit
  greater work.
- Permutations are generated lazily and deterministically.
- Exhausting the budget returns
  `CanonicalizationError::TooManyNDegreeCalls`.
- A dataset or graph is mutated only after canonicalization succeeds.

The pinned conformance evaluator runs ordinary and blank-node-map tests with
work factor three. It runs the poison test with the safe default and requires
the bounded-work error. This test-only allowance does not change the public
default.

## Evidence

- W3C RDFC-1.0 suite revision:
  `15619df2fda7a4ca88308733789b6774517f9638`
- Exact result: 86 passed, zero failed, zero unsupported
- Native OxRDF tests: 29 passed with all features and 16 passed without
  default features
- Strict all-feature and no-default-feature Clippy gates pass
- Agentic-QE profile: `rdfc-10`, with the W3C suite and submodule revision in
  its signed-content receipt

The canonicalization test asserts the exact 86-test inventory, so a silent
manifest addition or removal fails the release lane.

## Consequences

- Untrusted canonicalization fails closed instead of risking unbounded work.
- Existing callers must handle a `Result`.
- Trusted, difficult datasets can opt into a larger auditable budget.
- RDFC-1.0 evidence remains separate from RDF 1.2 evidence.
- RDFC-1.0 does not define RDF 1.2 triple-term canonicalization; Oxigraph's
  triple-term behavior remains explicitly non-standard.

## Alternatives rejected

- Keep an infallible API: cannot represent the required poison-dataset
  outcome.
- Accept the negative test without execution: produces false evidence.
- Use only a wall-clock timeout: non-deterministic and not composable in
  embedded or WASM environments.
- Precompute every permutation: increases memory amplification before the
  work guard can intervene.
- Apply the guard only to `Rdfc10`: the same implementation path is reachable
  through Oxigraph's unstable algorithms.

## Acceptance boundary

This decision supports the pinned RDFC-1.0 suite and bounded public
canonicalization API. It does not claim canonicalization semantics for RDF 1.2
triple terms or immunity from every possible resource-exhaustion vector.

## Sources

- [RDF Dataset Canonicalization 1.0](https://www.w3.org/TR/rdf-canon/)
- [RDFC-1.0 implementation report and test suite](https://w3c.github.io/rdf-canon/tests/)
