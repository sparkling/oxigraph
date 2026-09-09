# ADR-0002: RDF-native Datalog engine

- **Status**: Accepted
- **Date**: 2026-07-26
- Updated: 2026-09-09 (additive caller cancellation bridge)
- Deciders: Oxigraph parity programme
- Implementation status: D0, D1, and D2 implemented as bounded native profiles
- **Related**:
  [ADR-0007 — OWL 2 RL over Datalog](0007-owl-profiles-over-datalog.md),
  [ADR-0008 — SHACL processor profiles](0008-shacl-processor-profiles.md),
  [ADR-0009 — Snapshot reasoning and explicit materialization](0009-snapshot-reasoning-materialization.md),
  [ADR-0013 — Mutation competence and provenance
  policy](0013-mutation-competence-and-provenance.md)

## Context

RDFS closure, custom rules, SHACL Rules, and OWL 2 RL need the same finite
fixpoint mechanics. Compiling every rule to SPARQL would hide recursion,
stratification, provenance, and resource accounting. A production dependency
on Soufflé would also compromise the Rust/WASM deployment envelope.

## Decision

Maintain `lib/oxdatalog` as a storage-independent runtime with a public rule IR.
No backend type is exposed. The engine owns validation, indexed semi-naive
evaluation, deterministic result ordering, optional first-derivation
provenance, cancellation, and explicit limits.

The supported profiles are:

| Profile | Semantics |
|---|---|
| D0 | Function-free, range-restricted positive rules; recursion to a finite fixpoint |
| D1 | Stratified negation over declared closed dependencies; negative cycles rejected before execution |
| D2 | Run-once rules and deterministic evaluation-scoped blank-node generation |

The RDF adapter maps quads to internal relations and specializes fixed named
predicates to collision-checked generated relation identifiers. Collisions with
another generated predicate or a user relation fail closed.

The public IR remains syntax-neutral. RDFS, OWL vocabulary, SHACL syntax,
reporting, and profile conformance belong in consumer crates.

Canonical identifiers and values use explicit, length-delimited keys so
different tuples cannot alias by concatenation. Provenance selection and
working-set accounting use those canonical forms. D2 blank-node allocation
searches a finite identifier space derived from the current input and limit;
exhaustion returns the typed
`GeneratedBlankNodeSpaceExhausted` error instead of looping or panicking.

## Operational contract

- Rule, arity, range-restriction, stratification, identifier, and term limits
  are validated before or during bounded work.
- Time, cancellation, fact, intermediate-row, iteration, and estimated-memory
  ceilings return typed errors.
- D2 blank nodes are stable within one evaluation, not durable identities.
- Base data is immutable; evaluation returns base, inference, and entailed
  views.
- Memory accounting is deterministic for the runtime-owned workset, not an
  allocator-exact process measurement.
- A caller may attach a fast, nonblocking cancellation check to a token without
  introducing a runtime/thread or a dependency on its caller. A true result
  latches the shared atomic flag; clones retain explicit cancellation semantics.
  Oxigraph uses this bridge for request cancellation. Deadline provenance remains
  in the caller, not in the engine's boolean cancellation signal. Native tests
  verify latching and mid-input cancellation; this does not refresh any pinned
  mutation or consumer qualification receipt.

## Implementation evidence

- [OxDatalog public API](../../lib/oxdatalog/src/lib.rs) and
  [RDF adapter](../../lib/oxdatalog/src/rdf.rs)
- 70 all-target/all-feature tests covering D0, D1, D2, boundedness, the RDF
  adapter, exact provenance and accounting, mutation competence, finite
  blank-node allocation, and the Datafrog differential
- A Datafrog 2.0.1 test-only spike on the frozen recursive corpus
- [Jena 6.1.0 differential evidence](../../tools/datalog-oracles/README.md):
  two D0 fixtures and 17 agreed rows
- [Soufflé 2.5 differential evidence](../../tools/datalog-oracles/README.md):
  one stratified-negation/recursive D1 fixture
- [Store integration](../../lib/oxigraph/src/reasoning.rs): seven read-only,
  transaction, rollback, deduplication, snapshot, and D2 fail-closed tests,
  plus four cross-profile RDFS, OWL 2 RL, and SHACL snapshot tests

Mutation competence remains a mandatory source-bound release gate. The
reviewed configuration covers the D0–D2 engine, validation, RDF adapter, and
provenance implementation. Exact generated/caught/unviable counts belong to
the current receipt under `target/mutation/oxdatalog/receipt.json`; a receipt
whose protected-source hash does not match the release source is invalid.

## Consumers

- `oxrdfs` provides the bounded `rdfs-d0` compatibility profile and
  `rdfs-1.2-finite-active-vocabulary`.
- `oxowl` uses Datalog for 46 fixed-arity OWL 2 RL/RDF rule cores and bounded
  specialized operators for the remaining rule shapes.
- `oxshacl` compiles supported SHACL Rules patterns to stratified Datalog and
  returns a separate inference graph.
- `oxigraph`, behind its `datalog` feature, provides explicit snapshot
  evaluation and named-graph materialization.

## Consequences

- The semantic consumers share one bounded inference substrate.
- Rust, WASM, and embedded deployments do not require a C++ runtime.
- The project owns optimizer, validator, provenance, and resource-limit
  correctness.
- Incremental deletion, truth maintenance, backward/hybrid query modes, public
  RIF/Jena-rule parsers, impure built-ins, and unbounded function symbols remain
  outside this decision.

## Alternatives rejected

- Expose Datafrog as the public API: leaks backend concepts.
- Use Ascent or Crepe macros for runtime user rules: programs are primarily
  compile-time Rust.
- Bind Soufflé in production: unsuitable for the portability boundary; it
  remains a differential oracle.
- Put OWL or SHACL semantics in the generic engine: couples the runtime to
  consumer vocabularies and conformance classes.

## Evidence

- [Datafrog](https://github.com/rust-lang/datafrog)
- [Soufflé](https://souffle-lang.github.io/)
- [RIF Core](https://www.w3.org/TR/rif-core/)
- [SHACL 1.2 Rules](https://www.w3.org/TR/shacl12-rules/)

## Acceptance boundary

The engine profiles are implemented and natively tested. That does not imply
RDFS, OWL, SHACL, Jena, or W3C family conformance; each consumer must mint its
own opaque profile result and satisfy its own ledger.
