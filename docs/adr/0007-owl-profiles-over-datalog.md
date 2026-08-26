# ADR-0007: OWL 2 RL support over the Datalog engine

- **Status**: Accepted
- **Date**: 2026-07-26
- Deciders: Oxigraph parity programme
- Implementation status: bounded `owl2-rl-rdf` rule profile implemented
- **Related**:
  [ADR-0002 — RDF-native Datalog engine](0002-rdf-native-datalog-engine.md),
  [ADR-0006 — W3C-first 1.2 parity](0006-w3c-first-12-parity.md),
  [ADR-0009 — Snapshot reasoning and explicit materialization](0009-snapshot-reasoning-materialization.md)

## Context

OWL is a family of languages and semantics, not one capability. OWL 2 RL was
designed for scalable rule-based implementation and publishes an RDF rule
inventory covering classes, properties, equality, keys, datatypes, and
contradictions. That is a strong fit for bounded Datalog, but several RL rules
need RDF-list, equality, datatype, key, or inconsistency operators that cannot
be expressed as fixed-arity legal-RDF facts alone.

## Decision

Implement only OWL 2 RL in this programme. Expose the RDF-based rule profile as
`owl2-rl-rdf`. Do not expose generic “OWL”, OWL 2 EL, QL, DL, Full, Jena OWL
Micro/Mini/default, or a best-effort extended mode.

`lib/oxowl` owns:

- OWL vocabulary and rule metadata;
- the exact 78 identifiers in W3C OWL 2 RL/RDF Tables 4–9;
- compilation and bounded evaluation;
- RDF-list, equality, datatype, key, and contradiction operators;
- first-derivation provenance and execution-path diagnostics; and
- an opaque profile-specific result and receipt.

`oxowl` depends on `oxdatalog`; the generic engine does not depend on OWL.

## Execution split

| Path | Rules | Role |
|---|---:|---|
| `oxdatalog::Program` | 46 | Positive fixed-arity rule cores |
| Bounded specialized operators | 32 | Equality/list/key/datatype/generalized-fact/contradiction semantics |

Specialized operators are part of the OWL profile, not hidden Datalog opcodes.
Receipts report both counts and every derivation records its execution path.

The runtime:

- computes deterministic legal-RDF inference plus generalized equality facts;
- treats inconsistency as an explicit result with evidence, not explosion;
- validates malformed/cyclic/incomplete or over-limit RDF lists;
- uses an explicit RL datatype mode and rejects unsupported datatypes in strict
  mode;
- respects Datalog time, cancellation, fact, iteration, intermediate-row, and
  estimated-memory limits; and
- leaves base data immutable.

## Implemented evidence

- [OWL 2 RL/RDF public API](../../lib/oxowl/src/lib.rs)
- [Exact 78-rule inventory and 46/32 split](../../lib/oxowl/src/full_rules.rs)
- 34 native tests: one unit test, 13 positive-seed/API tests, 10 datatype
  value-space tests, and 10 full bounded-processor tests
- [Hash-pinned W3C runner](../../tools/owl2-tests/README.md):
  70 approved RL cases inventoried, 68 RDF-based cases executed, and 98 of 98
  entailment/non-entailment/consistency/inconsistency assertions passed
- Pinned approved-export SHA-256:
  `af67cd7a007cbed8a54255d094a88f7304ec950457e13df58b51f507c6c29d00`
- Pinned `support011-A` import SHA-256:
  `f92a919635e21ad412662c5544a1a9003652a3c8a09ae25620fc2e29a72a2572`

The evidence runner is a standalone Cargo workspace whose checked-in nested
lockfile is enforced with `--locked`. A local dependency-graph change therefore
fails closed until that lock is intentionally refreshed and the 98 assertions
are rerun.

The runner supports the RDF/XML corpus, three Functional Syntax premise
translations used by the export, the pinned import, and existential
blank-node matching. These are test-harness capabilities; they do not create a
general structural OWL parser or imports manager.

## Claim boundary and open scope

The allowed claim is a bounded `owl2-rl-rdf` rule-engine profile with the exact
official assertion result above. The following are not established:

- OWL 2 RL Direct Semantics processor conformance;
- a complete structural-syntax parser/profile checker;
- general imports closure or network retrieval in the library API;
- all OWL 2 conformance requirements outside the executed RDF-based export;
- unrestricted datatype maps or infinite axiomatic closure;
- `xsd:date`, which is outside the current normative OWL RL datatype map;
- canonical XML equality across distinct lexical forms—the self-contained XML
  validator deliberately implements a safe subset; or
- any OWL profile beyond RL.

The legacy `owl2-rl-rdf-positive-seed` remains a deliberately narrower
compatibility API and cannot mint a full-profile receipt.

## Consequences

- Datalog supplies most rule execution while bounded operators handle the
  representational boundary honestly.
- Equality, datatypes, lists, keys, and contradictions are tested as named
  semantics rather than approximated away.
- Users must request an exact profile and cannot accidentally enable general
  OWL reasoning.
- A future Direct Semantics profile requires a new evidence contract, but no
  broader OWL family is implied.

## Alternatives rejected

- Encode every rule as ordinary Datalog: legal RDF and variable arity cannot
  represent all required conclusions and lists.
- Put OWL vocabulary in `oxdatalog`: pollutes the generic kernel.
- Publish Jena reasoner modes: they are not the W3C RL contract.
- Target OWL 2 DL with forward rules: not complete for DL semantics.
- Use Java as the production reasoner: breaks the Rust/WASM boundary.

## Evidence

- [OWL 2 Profiles](https://www.w3.org/TR/owl2-profiles/)
- [OWL 2 Conformance](https://www.w3.org/TR/owl2-conformance/)
- [OWL 2 Structural Specification](https://www.w3.org/TR/owl2-syntax/)
- [SPARQL 1.2 Entailment Regimes](https://www.w3.org/TR/sparql12-entailment/)

## Acceptance boundary

The complete named RDF-rule inventory and applicable approved RDF-based test
assertions are green. Broader OWL 2 RL or OWL family claims remain blocked by
the explicit open scope above.
