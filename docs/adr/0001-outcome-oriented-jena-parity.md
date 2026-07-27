# ADR-0001: Outcome-oriented Apache Jena parity

- Status: Accepted
- Date: 2026-07-26
- Deciders: Oxigraph parity programme
- Amended by:
  [ADR-0006 — W3C-first 1.2 parity](0006-w3c-first-12-parity.md)
- Related:
  [ADR-0002 — RDF-native Datalog engine](0002-rdf-native-datalog-engine.md),
  [ADR-0008 — SHACL processor profiles](0008-shacl-processor-profiles.md),
  [ADR-0012 — Immutable broad Jena differential
  harness](0012-immutable-broad-jena-harness.md)

## Context

Apache Jena 6.1.0 is a broad Java platform. It includes RDF and SPARQL,
datasets, servers, validation, inference, ontology APIs, text and spatial
extensions, and operational modules. Oxigraph has a smaller Rust, WASM, Python,
JavaScript, and HTTP shape. Copying Jena packages would reward implementation
similarity rather than compatible user outcomes.

Jena also cannot define RDF, SPARQL, SHACL, or OWL semantics. It is a useful
production differential only where its documented behavior intersects a
selected W3C profile.

## Decision

Use named, versioned compatibility profiles. `jena-12-compat` means observable
agreement with Jena 6.1.0 only for an enumerated scenario set. It does not mean
full Jena product parity or W3C conformance.

Every compatibility profile records:

1. the exact Jena version and fixture inventory;
2. supported outcomes and exclusions;
3. normalization rules;
4. positive, negative, and adversarial execution evidence;
5. exposed interfaces and operational limits; and
6. a reproducible receipt tied to source and oracle inputs.

W3C semantics wins when a selected standards snapshot and Jena disagree.
Jena-only behavior requires an explicit, opt-in `jena-extension` profile.
When the selected W3C text permits both observed outcomes, record a
`w3c-permitted-divergence`; this is neither an override nor a conformance
failure.

The delivery order is:

1. implement a native bounded semantic core;
2. compare matching Jena outcomes;
3. close independently receipted W3C-only requirements; and
4. consider broader Jena operational outcomes as separately scoped work.

## Implemented evidence

The immutable broad differential profile contains 76 reviewed scenarios and
198 assertions across RDF (17 scenarios/46 assertions), SPARQL (30/77), SHACL
(13/43), finite RDFS (7/14), and selected OWL 2 RL (9/18). Its scenario
classifications are:

| Classification | Scenarios | Meaning |
|---|---:|---|
| `agreement` | 70 | Both engines meet the scenario's reviewed assertion |
| `w3c-overrides-jena` | 4 | Oxigraph follows the selected W3C requirement instead of Jena |
| `w3c-permitted-divergence` | 1 | The selected W3C text permits both distinct successful outcomes |
| `jena-extension` | 1 | Jena-only behavior is isolated from the standards profile |
| `unsupported` | 0 | No reviewed scenario remains at a fail-closed boundary |

These counts describe only
`jena-6.1.0-outcome-intersection-2026-07-27-v1`. They do not cover Jena's
complete RDF I/O, ARQ, SHACL, reasoner, TDB2, Fuseki, text, spatial, ontology,
or client-API surfaces. The earlier
[Datalog and finite RDFS oracles](../../tools/datalog-oracles/README.md) remain
focused supporting differentials rather than substitutes for this matrix.

The broad harness writes its current generated evidence to
`target/jena-parity/parity-receipt.json`,
`target/jena-parity/resolved-inventory.json`, and
`target/jena-parity/jena-observations.json`. The
[conformance ledger](../research/conformance-ledger.json) therefore permits
only the exact named compatibility-profile result and continues to prohibit
an unqualified “Jena parity” claim.

## Consequences

- Oxigraph retains idiomatic Rust and portable deployment boundaries.
- Reference quirks cannot silently become normative behavior.
- Compatibility and conformance remain separately reviewable.
- Additional matrices remain necessary for every Jena surface outside the
  enumerated profile.

## Alternatives rejected

- Clone Jena package-by-package: Java-shaped and not outcome-oriented.
- Report one parity percentage: collapses unlike capabilities.
- Ignore Jena: discards valuable production scenarios.
- Stop at Jena agreement: makes a reference implementation the standards
  ceiling.
- Wrap Jena at runtime: breaks ownership, WASM, and embedded deployment goals.

## Evidence

- [Apache Jena documentation](https://jena.apache.org/documentation/index.html)
- [Apache Jena inference](https://jena.apache.org/documentation/inference/index.html)
- [Apache Jena SHACL](https://jena.apache.org/documentation/shacl/)
- [Jena/Oxigraph research summary](../research/jena-oxigraph-parity-summary.md)
- [Machine-readable Jena/Oxigraph dossier](../research/jena-oxigraph-parity-dossier.json)

## Acceptance boundary

`jena-12-compat` can be claimed only after its outcome inventory has set
equality with executed receipts and no unresolved scenario. Current evidence
supports the exact 76-scenario, 198-assertion profile above. It does not
support complete Apache Jena product parity or any W3C family-conformance
claim.
