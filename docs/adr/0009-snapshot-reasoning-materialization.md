# ADR-0009: Snapshot reasoning and explicit materialization

- Status: Accepted
- Date: 2026-07-26
- Deciders: Oxigraph parity programme
- Implementation status: optional Oxigraph Datalog integration implemented
- Related:
  [ADR-0002 — RDF-native Datalog engine](0002-rdf-native-datalog-engine.md),
  [ADR-0007 — OWL 2 RL over Datalog](0007-owl-profiles-over-datalog.md),
  [ADR-0008 — SHACL processor profiles](0008-shacl-processor-profiles.md)

## Context

Inference can be a read view, an explicit one-shot write, or incremental truth
maintenance. Treating these as one operation risks mutating source data,
mixing snapshots, duplicating collapsed graph results, or reminting D2
existential blank nodes on every replay.

## Decision

Expose Datalog/store integration only behind the optional Oxigraph `datalog`
feature with two explicit operations:

1. `evaluate_store` copies one repeatable-read store snapshot and returns an
   owned base/inference/entailed closure without writing.
2. `materialize_to_graph` evaluates and writes within one store transaction,
   replacing every inferred source graph name with a caller-selected named
   target graph.

Materialization deduplicates quads after graph-name collapse and commits the
batch atomically. Failure leaves the store unchanged.

D2 programs are rejected before materialization with
`D2MaterializationRequiresOwnedGraph`. Their blank nodes are
evaluation-scoped; incremental insertion could otherwise mint a new
existential on every run. Supporting them later requires an owned-graph
replacement policy with stable lifecycle semantics, not a relaxed check.

## Isolation contract

The write operation is a one-shot repeatable-read materialization against the
transaction snapshot. It is not:

- serializable truth maintenance against concurrent writers;
- incremental insertion/deletion maintenance;
- provenance persistence;
- automatic mutation of the default or source graph; or
- a validation-before-commit hook.

Callers own graph replacement, staleness, retraction, and scheduling policy.

## Evidence

- [Store reasoning implementation](../../lib/oxigraph/src/reasoning.rs)
- [Store reasoning tests](../../lib/oxigraph/tests/reasoning.rs)

Seven integration tests cover read-only base/inference separation, explicit
atomic materialization, rollback on evaluation failure, repeatable snapshot
behavior, deduplication after graph collapse, and repeated D2 fail-closed
behavior, including preservation of explicit empty named-graph topology in the
owned snapshot.

A separate four-test semantic-integration lane passes 4 of 4 checks for
read-only RDFS evaluation, read-only OWL 2 RL evaluation, stable SHACL
validation, and explicitly feeding an RDFS closure to SHACL without mutating
the store. These tests establish the public adapter composition exercised by
those four scenarios; they do not establish family-wide RDFS, OWL, or SHACL
conformance.

The Oxigraph `rdfs` feature enables `rdf-12`; consequently
`evaluate_store_rdfs12` always selects the 15-pattern finite RDFS 1.2 profile.
The separate 14-pattern RDF 1.2 Basic build remains available only through a
direct `oxrdfs` dependency without its `rdf-12` feature. This prevents a
Store-facing API named RDFS 1.2 from silently changing profile identity with
an unrelated feature combination.

## Consequences

- Read-only inference is the safe default.
- Writes are explicit, graph-scoped, transactional, and measurable.
- D2 replay cannot silently accumulate generated nodes.
- Incremental truth maintenance and owned-graph D2 replacement remain future
  capabilities with separate correctness obligations.

## Alternatives rejected

- Implicitly mutate the base graph: hides a destructive semantic change.
- Evaluate outside the transaction then write: permits a split snapshot.
- Allow D2 append materialization: creates unstable existential identity.
- Claim serializable truth maintenance: unsupported by a one-shot transaction.

## Acceptance boundary

Current evidence supports explicit snapshot evaluation and D0/D1 one-shot
named-graph materialization only. It does not establish incremental or
serializable reasoning.
