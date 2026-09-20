# ADR-0008: SHACL processor profiles

- **Status**: Accepted
- **Date**: 2026-07-26
- Deciders: Oxigraph parity programme
- Implementation status: dated feature-set processor implemented; complete
  SHACL 1.2 conformance requests fail closed
- **Related**:
  [ADR-0002 — RDF-native Datalog engine](0002-rdf-native-datalog-engine.md),
  [ADR-0003 — W3C 1.2 conformance baseline](0003-w3c-12-conformance-baseline.md),
  [ADR-0006 — W3C-first 1.2 parity](0006-w3c-first-12-parity.md)

## Context

SHACL 1.2 is a family of evolving drafts: Core, Node Expressions, SPARQL
Extensions, Rules, UI, Profiling, Compact Syntax, and informative overview
material. The pinned W3C root test manifest covers approved Core, Node
Expressions, and SPARQL entries but does not include Rules. Test coverage is
not a complete normative requirement inventory.

At the 2026-07-27 edge review, Core was a 2026-07-23 Working Draft, SPARQL
Extensions a 2026-07-24 Working Draft, Node Expressions a 2026-07-21 Working
Draft, Rules a 2026-07-27 Working Draft, UI a 2026-05-26 First Public Working
Draft, and Profiling a 2026-07-02 First Public Working Draft. Overview and
Compact Syntax were editor-only documents. These moving statuses do not alter
the immutable release pin or turn editor examples into approved conformance
tests.

Validation also has a different product boundary from Datalog: it owns shape
compilation, targets, paths, focus/value nodes, constraint semantics, result
graphs, severities, messages, recursion, and report canonicalization.

## Decision

Maintain `lib/oxshacl` as a store-neutral processor with explicit dated
feature-set profiles:

| Profile identifier | Surface |
|---|---|
| `shacl-1.2-core-2026-07-23-subset-v1` | Core targets, paths, constraints, reports, and RDF 1.2 additions |
| `shacl-1.2-node-expressions-2026-01-08-subset-v1` | Bounded node-expression evaluation |
| `shacl-1.2-sparql-extensions-2026-01-30-subset-v1` | Sandboxed SPARQL constraints and custom validators |
| `shacl-1.2-rules-2026-07-27-subset-v1` | A programmatic Rust triple-rule API compiled to Datalog (**not** an `sh:TripleRule` RDF parser — see below) plus bounded SRL `Infer` and `QUERY` operations |
| `shacl-1.2-compact-syntax-2025-10-30-subset-v1` | Bounded SHACL-C parsing and RDF mapping |

These identifiers retain the implementation snapshots they name; they are not
claims that every later edge-draft clause is implemented.

Extension profiles require the dated Core profile. SPARQL requires the crate
feature. Requests for complete Core, Node Expressions, SPARQL Extensions,
Rules, or Compact Syntax conformance return a typed `UnsupportedComplete`
error.

## Processor boundary

- Validation consumes an owned read-only graph snapshot.
- Shapes compile from RDF to typed targets, paths, constraints, expressions,
  and rules before evaluation.
- Property paths and recursive shape/expression evaluation are resource
  bounded.
- Reports sort results deterministically and emit a stable report dataset and
  canonical N-Quads receipt.
- Cancellation, elapsed time, focus nodes, violations, recursion, query
  solutions, inferred facts, and estimated memory have explicit limits.
- Native SPARQL-backed validation, node-expression, and rule execution uses a
  watchdog that propagates both the caller cancellation token and the remaining
  deadline into the synchronous evaluator. On `target_family = "wasm"`, where
  that synchronous evaluator has no cooperative deadline hook and no watchdog
  thread is available, those SPARQL-backed operations fail closed before query
  execution. Datalog-backed rules instead share the caller's cancellation token
  directly on every target and retain their internal time, row, iteration, and
  memory limits.
- SPARQL validators forbid service access, dataset clauses, graph mutation,
  selected dangerous operators, and reserved-variable rebinding.
- General custom functions compile through the node-expression and sandboxed
  SPARQL runtime, including blank-term-safe argument binding. This implemented
  extension point does not establish every custom component or validator
  clause.
- Rules return a separate inference graph. Supported positive and negative
  typed triple patterns execute through stratified `oxdatalog`.
  `sh:SPARQLRule` CONSTRUCT queries execute in an isolated, bounded SPARQL
  fixpoint with focus nodes, conditions, order, and deactivation. The public
  SRL surface provides bounded `Infer` and `QUERY` operations. The typed
  Datalog-backed rule API does not expose generated head terms.

The processor does not mutate an Oxigraph store or automatically validate a
transaction. Applications choose snapshots, entailment, and write policy.

## Evidence

- [SHACL public API](../../lib/oxshacl/src/lib.rs)
- [Profile and fail-closed conformance types](../../lib/oxshacl/src/profile.rs)
- [Bounded SHACL-C parser](../../lib/oxshacl/src/compact.rs)
- [W3C inventory and runner](../../tools/shacl-tests/README.md)
- Pinned W3C Data Shapes commit:
  `eedda09f93c39be1d2e978f3f942631494ae25a0`
- Pinned suite-content SHA-256:
  `1d2c1c40769da1cf63fef62f3029447a66b5e81b5744b4cf2eaa5e128ba51a3a`

The reviewed specification SHA-256 values are:

| Specification | SHA-256 |
|---|---|
| Core | `69497e1f3ef6993766f8a4f0812b61f4aa23b75e6a18e7425bc66dbf65d59b6e` |
| Node Expressions | `a1db16376a928ed90acd049537c645c4750f6fe2cb1ab99656ac689b40681f72` |
| SPARQL Extensions | `c94be2019923aedacf01fe312404ef1e618bb06e3f9587eae35400633088db1c` |
| Rules | `45ef06db0d7df325171e877032774f989f96a22f96d2cc373755eda1dd514ad4` |
| Compact Syntax | `f6db1b05cd0201e7afb16dcc5b02c9306c7568cfbdf487b81c19ee14e34151cd` |

The consolidated runner discovers 521 cases and passes 519/519 eligible cases
across the five named lanes below. Two invalid upstream validation fixtures
are excluded by path, content hash, and reason. The native Rust matrices pass
167/167 tests with all features and 114/114 with default features disabled.
Apache Jena 6.1.0 independently passes the same 32 SHACL-C positive pairs.
Exact counts and artifacts are recorded in the
[conformance ledger](../research/conformance-ledger.json). Exclusions and
unsupported cases never count as passes.

The count is deliberately decomposed:

| Lane | Result | Claim classification |
|---|---:|---|
| Root-reachable validation | 167 / 167 | Reviewed validation evidence |
| Root-reachable Node Expressions | 143 / 143 | Reviewed node-expression evidence |
| Legacy `Infer` | 6 / 6 | Legacy rules compatibility evidence |
| Separate current-draft Rules manifest | 171 / 171 | Supplemental Rules evidence |
| SHACL Compact Syntax positive fixtures | 32 / 32 | Informative translation compatibility |

## Explicit exclusions

The current public profiles do not claim:

- complete SHACL 1.2 Core, Node Expressions, SPARQL Extensions, or Rules;
- complete SHACL UI or Profiling support, or complete Compact Syntax
  parser/mapping conformance;
- custom component/validator semantics beyond the implemented general-function
  and parameterized validator surfaces;
- generated-node or other SHACL Rules forms outside the typed triple-pattern
  API;
- automatic RDFS/OWL entailment selection;
- incremental validation or global store-policy enforcement (the opt-in native
  transaction gate is separately scoped by [ADR-0021](0021-transaction-time-shacl-validation.md));
- cross-language binding parity; or
- SPARQL-backed execution on synchronous WebAssembly until the evaluator can
  guarantee cooperative timeout and cancellation checks.

The pinned root manifest reaches validation, Node Expressions, and SPARQL
material, but it does not reach Rules. The runner invokes the separate
`manifest-rules.ttl` explicitly; its 171 passing syntax, well-formedness,
stratification, and result-graph cases are supplemental evidence rather than
root-manifest approval. The six legacy SHACL-SPARQL `Infer` cases remain a
separately named compatibility lane.

That 171 is measured at pin `eedda09f` and is not a current figure. Upstream has
since moved the corpus to `shacl12-test-suite/tests/sparql-rl/` (manifest
renamed to `manifest-sparql-rl.ttl`). The September 19 listing contained
**198 `.srl` files**, including a new `eval2/` directory whose 6 `WHERE DATA` cases
have not yet been revalidated against a new pin. Re-pinning follows the
corresponding implementation work — see
[ADR-0046](0046-shacl-12-editors-draft-realignment.md).

The listing did not establish a manifest case count. September 20 research at
revision `0ccfab4f28324edaac59a1227f8c60ad5b7bbf89` counted **203
manifest-listed SRL cases** against 198 `.srl` files. The coordinator accepted
this exact implementation candidate; its suite execution remains pending.
Existing dated profile identities and historical evidence retain their pin.
Earlier counts of "290 fixtures", "19 WHERE DATA
cases", and "198 test cases" conflated files with cases.

The 32 Compact Syntax inputs are positive, unmanifested fixtures associated
with an editor-only draft. Upstream provides no normative negative corpus.
Local negative syntax, limit, parse/RDF/serialization round-trip tests and the
32/32 Jena differential strengthen the bounded implementation evidence, but
prove only the recorded translation compatibility.

Rewritten 2026-09-19 (see [ADR-0046](0046-shacl-12-editors-draft-realignment.md)).
The paragraph this replaces described a document that no longer exists and
three issues whose status it stated wrongly.

The rule language this profile implements is no longer part of SHACL: the
`shacl12-rules` document was renamed to **SPARQL-RL** on 2026-08-19 (commit
`df4ee468`), with its own `.srl` extension and `application/sparql-rl` media
type. A separate, newer `shacl12-inference-rules` document governs
`sh:TripleRule` and `sh:SPARQLRule`. Our evidence above is pinned at
`eedda09f`, which predates both changes.

Against the live SPARQL-RL draft, our stratification terminology, run-once
derivation, the stratification condition, and bounded fixpoint iteration all
match — the bounded fixpoint is **no longer** merely an implementation choice
for the iteration model itself, though the interaction with repeated firing
below remains open. Current alignment and remaining divergences:

- **`WHERE DATA` / `NOT DATA`** is implemented in `e9a285c8` (2026-09-20):
  frozen base-plus-inline GD, accumulating GE, sticky WHERE DATA and local
  NOT DATA. Focused and feature-matrix evidence is recorded in ADR-0046;
  the upstream suite repin remains separate.
- **`FOR`/`IN` was removed** from the grammar on 2026-08-12. It is not a pending
  obligation; our parser rejects the removed syntax instead of carrying it to
  execution as an unsupported extension.
- **Body abbreviations** — collections, blank-node property lists, reifiers and
  annotation blocks — are implemented in `6e933eea`, including standalone
  collection/reified patterns and rule-wide existential blank labels. Matching
  and dependency analysis share expansion; RDF 1.2 constructs fail closed before
  matching when the feature is disabled. Inline DATA triple-term lowering remains
  a separate gap; see ADR-0046's delivered scope and checks.
- **Repeated firing** remains genuinely draft-open in issue 1069, and
  `sh:runOnce` in the inference-rules document is the surface that would settle
  it. This one exclusion stands as originally written.

The Datalog triple-rule surface (`lib/oxshacl/src/rules.rs`) is a programmatic
Rust API. It has **no `sh:TripleRule` RDF compiler at all**, so its lack of
`sh:order`/`sh:condition`/`sh:deactivated`/`sh:layer` is not a set of missing
fields but an absent ingestion path. The `sh:SPARQLRule` surface does implement
`sh:order`, `sh:condition` (including the required rejection of conditions on
global rules) and `sh:deactivated`. Since `6e933eea`, it supports numeric
`sh:layer`, closes layers before advancing, and uses uniform rule ordering with
equal-order snapshot isolation across global and shape-attached rules.
Since `e9a285c8`
it fails closed on explicit `sh:ruleProcessor` declarations on rules and rule
sets. No custom processor identifier is supported; absence uses the default.

Neither the Rules nor Compact Syntax lane closes the corresponding normative
clause inventory.

## Consequences

- Applications get a deterministic, bounded native validation layer; WASM
  retains non-SPARQL and Datalog-backed processing while unsupported
  SPARQL-backed execution fails closed.
- Draft changes cannot silently broaden an undated `shacl` capability.
- Datalog is reused for Rules without absorbing SHACL reporting semantics.
- Complete-family work remains visible instead of being hidden behind a green
  subset suite.

## Alternatives rejected

- Call any passing subset “SHACL 1.2”: overstates the conformance class.
- Implement Rules directly in the validator loop: duplicates fixpoint,
  stratification, provenance, and limits.
- Execute unrestricted user SPARQL: violates the isolation boundary.
- Mutate base data during validation: conflates observation and policy.

## Evidence sources

- [SHACL 1.2 Core](https://www.w3.org/TR/shacl12-core/)
- [SHACL 1.2 Node Expressions](https://www.w3.org/TR/shacl12-node-expr/)
- [SHACL 1.2 SPARQL Extensions](https://www.w3.org/TR/shacl12-sparql/)
- [SPARQL-RL](https://www.w3.org/TR/sparql12-rl/) — the rule language our SRL
  surface implements; `shacl12-rules` was renamed to this on 2026-08-19
- [SHACL 1.2 Inference Rules](https://www.w3.org/TR/shacl12-inference-rules/) —
  the separate document governing `sh:TripleRule` and `sh:SPARQLRule`

## Acceptance boundary

The dated feature sets are releasable only with exact receipts and explicit
unsupported accounting. `shacl12-w3c` remains open until its complete
applicable normative ledger and all interface contracts close.
