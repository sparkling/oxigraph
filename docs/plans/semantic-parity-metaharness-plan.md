# Semantic parity implementation and qualification plan

- Programme date: 2026-07-26
- Updated: 2026-08-27
- Target: version-pinned Apache Jena compatibility, then current reviewed W3C
  RDF 1.2, SPARQL 1.2, and SHACL 1.2 parity
- Reasoning scope: RDFS, bounded Datalog D0–D2, and OWL 2 RL/RDF only
- Claim authority:
  [ADR-0006 — W3C-first 1.2 parity](../adr/0006-w3c-first-12-parity.md)
- Machine state:
  [conformance ledger](../research/conformance-ledger.json)
- Normative mapping:
  [requirements inventory](../research/normative-requirements.json)

## Outcome

The native engine tranche and the pinned RDF/SPARQL/OWL official-suite lanes
are implemented. All 31 registered RDF, SPARQL, and SHACL documents now have a
machine-readable mapping to 79 stable grouped obligations. The ultimate
family-parity goal is not yet claimable because sentence-level normative
enumeration, SHACL draft/upstream gaps, any Jena scope beyond the closed
76-scenario outcome intersection, and cross-interface contracts are not all
closed.

This plan separates implementation completion from evidence completion. A
green finite suite never marks a broader phase complete by itself.
The `tools/metaharness` package described here remains the semantic qualifier;
ADR-0017 assigns future application delivery to a separate
`tools/engineering-harness`, which is now implemented and independently
bounded but is not owned or qualified by this semantic plan.

## Current evidence snapshot

The counts below describe bounded receipts for their exact subjects. G0.1-G0.7
have refreshed and reconciled the registered sources, locked Jena profile,
Agentic-QE CLI and persistence-write inventories, and generic OxDatalog
mutation binding described by the
[evolution harness plan](linked-data-store-evolution-harness-plan.md). Those
scoped closures do not create a current full MetaHarness receipt or an umbrella
semantic claim.

| Capability | Executable evidence | Current classification |
|---|---|---|
| Datalog D0–D2 | 70 native tests; G0.6 run `731e6467...` has 358 mutants = 278 caught + 80 unviable, 0 missed/timeouts | Implemented bounded engine profile; current source/runtime-bound mutation gate for the generic D0-D2 scope only |
| Semantic store integration | 4 tests | RDFS, OWL 2 RL, SHACL, and chained RDFS→SHACL stable-snapshot integration |
| RDFS | 37 native tests; RDF 1.2 Semantics aggregate 77/77, including 26/26 RDFS-regime cases | Finite active-vocabulary profile; the aggregate also contains 24 Simple- and 27 RDF-regime cases and is not an RDFS-only receipt |
| OWL 2 RL/RDF | 34 native tests; 98/98 assertions over 68 cases; 78-rule inventory | Bounded RDF-rule profile; broader OWL excluded |
| RDF 1.2 | 575/575 official tests, 0 unsupported | Official-suite complete; normative family ledger open |
| SPARQL 1.2 | 269/269 official tests, 0 unsupported | Official-suite complete; normative family ledger open |
| RDF Dataset Canonicalization 1.0 | 86/86 official tests | Supporting specification; not RDF 1.2 family parity |
| SHACL 1.2 | 521 discovered and 519/519 eligible across five separately classified lanes; two hash-pinned invalid upstream exclusions; native Rust 167/167 all-feature and 114/114 no-default; Jena SHACL-C 32/32 | Root, legacy, supplemental Rules, and informative SHACL-C evidence; family claim open |
| Jena 6.1.0 | G0.3 subject `182972ec...`: 76 reviewed scenarios; 198 assertions; two byte-identical runs | Current locked outcome-intersection scope with one W3C-permitted implementation variant; full Apache Jena parity not claimed |
| Soufflé 2.5 | 1 stratified Datalog fixture | Narrow D1 differential only |
| Agentic-QE `latest` (currently lock-resolved to 3.13.12) | 19/19 adapter adversarial tests; reconciled 144/129 CLI and 34/34 persistence-write profiles; 47-command parity inventory | Scoped profiles are current; aggregate acceptance still requires a complete, current, independently verified receipt; native commands remain authoritative |
| MetaHarness/Darwin | Full semantic-mode runner plus independent receipt verifier | No qualification result exists unless both current receipts verify against the same protected snapshot |

Exact SHACL lane counts, exclusions, and artifact locations are read from the
conformance ledger. They must not be inferred from inventory totals or promoted
to a complete-family claim.

The exact supporting parser lane passes 5/5 wrappers. Within those wrappers, N3
passes 208 parser, 871 extended, and 296 Turtle cases, but
both 87-entry reasoner manifests remain unsupported because no reasoner
handler/wrapper is registered. JSON-LD ToRDF passes 446 of 467 entries with 21
declared exclusions. Streaming has 483 physical/481 unique entries: four
physical entries for duplicate IDs `t0124` and `t0125` are quarantined by a
fail-closed preflight; the remaining 479 divide into 452 passes and 27 declared
failures. JSON-LD FromRDF is not automated: the generic manual audit passes
9/54 and fails 45/54, including current `t0027` and `t0028`.

## Architecture slices

### Slice A: evidence contracts — implemented

- Pin the standards, test-source, reference-engine, and supporting-suite
  registry without treating supporting suites as family conformance.
- Separate Jena compatibility, reviewed W3C, and editor-draft edge lanes.
- Use opaque profile-specific results so generic closures cannot mint narrower
  RDFS, OWL, or SHACL receipts.
- Reject unsupported full-conformance requests through typed APIs.

Gate A remains open for family claims until every applicable normative clause
has a reviewed disposition and executable evidence.

### Slice B: Datalog and storage — implemented

- D0 positive, function-free, range-restricted semi-naive recursion.
- D1 dependency analysis, closed relations, and stratified negation.
- D2 run-once rules and evaluation-scoped deterministic blank nodes.
- RDF predicate specialization with fail-closed identifier collision checks.
- Limits, cancellation, provenance, queryable RDF views, and deterministic
  receipts.
- Store snapshot evaluation and explicit atomic D0/D1 named-graph
  materialization.
- D2 store materialization rejected until owned-graph replacement exists.

Release gate:

- all 70 engine tests and 4 semantic profile integration tests;
- strict Clippy, Rustdoc, and supported WASM checks;
- Jena and Soufflé differentials;
- fresh final mutation receipt with zero viable survivors and zero timeouts.

### Slice C: RDFS and OWL 2 RL/RDF — implemented bounded profiles

- Retain `rdfs-d0` for compatibility.
- Implement all 15 RDFS 1.2 finite active-vocabulary patterns, axioms,
  bounded container vocabulary, datatype consistency, and deterministic
  existential witnesses.
- Implement all 78 OWL 2 RL/RDF rule identifiers: 46 Datalog cores and 32
  bounded specialized operators.
- Expose contradictions, generalized facts, datatype policy, execution-path
  provenance, and bounded receipts.

Release gate:

- native counts above;
- 26/26 RDFS-regime cases within the 77/77 RDF 1.2 Semantics aggregate
  (24 Simple, 27 RDF, 26 RDFS);
- 98/98 W3C OWL assertions and exact source hashes;
- negative resource and malformed-input tests;
- no unqualified RDFS or OWL label.

### Slice D: RDF and SPARQL 1.2 official suites — implemented

- Execute all pinned RDF syntax, evaluation, canonicalization, and Semantics
  manifests with a strict empty unsupported ledger.
- Execute the pinned SPARQL 1.2 manifest with a strict empty unsupported
  ledger.
- Fail when a declared unsupported case starts passing or is not evaluated.

Gate D is complete for official-suite evidence and open for family parity.
Remaining work is clause mapping, operational protocols, interface exposure,
supplemental tests, and edge-draft drift review.

### Slice E: SHACL dated feature sets — implemented, closure open

- Parse RDF shapes into typed targets, paths, constraints, node expressions,
  SPARQL validators, and rules.
- Compile and execute general custom functions through the bounded
  node-expression/SPARQL runtime, including blank-term-safe bindings.
- Validate one owned snapshot with recursion, result, query, inference, time,
  cancellation, and estimated-memory limits.
- Keep those controls truthful across targets: native SPARQL-backed work uses a
  deadline/cancellation watchdog; synchronous WASM fails closed before
  SPARQL-backed validation, node-expression, or rule evaluation because the
  evaluator has no cooperative deadline hook. Datalog-backed rules share the
  caller cancellation token directly and retain engine-enforced limits.
- Produce deterministic report graphs and receipts.
- Compile supported positive/negative SHACL Rules patterns to Datalog D1;
  retain D2 as the bounded engine facility for future generated-head forms.
- Execute supported `sh:SPARQLRule` CONSTRUCT rules through an isolated,
  bounded SPARQL fixpoint, and expose bounded public SRL `Infer` and `QUERY`
  operations.
- Run the pinned root suite; count passed, failed, and unsupported separately.
- Inventory current-draft Rules separately because it is not root-manifest
  reachable; run the six legacy approved SHACL-SPARQL `Infer` cases as a
  separate compatibility lane.
- Execute the separate 171-case `manifest-rules.ttl` syntax,
  well-formedness, stratification, and result-graph corpus as a supplemental
  lane because it is not root-reachable and has no `mf:approval` value.
- Execute the 32 SHACL-C source/graph pairs as a positive informative
  translation lane; they are editor-only and unmanifested, upstream has no
  normative negative corpus, and local negative/round-trip tests plus a 32/32
  Jena 6.1.0 differential provide bounded supplemental evidence.

Gate E closes only after:

- zero failures and zero unsupported entries for the claimed feature set;
- complete applicable Core, Node Expressions, SPARQL, and Rules clause maps;
- supplementary Rules tests;
- explicit UI, Profiling, and Compact Syntax dispositions; and
- cross-interface agreement.

### Slice F: Jena compatibility intersection — scoped profile closed

The immutable `jena-6.1.0-outcome-intersection-2026-07-27-v1` matrix contains
76 reviewed scenarios and 198 assertions across:

- RDF 1.2 parsing/serialization and RDF-star migration behavior (17
  scenarios/46 assertions);
- ARQ query, update, result formats, and entailment selection (30/77);
- SHACL Core/SPARQL report outcomes (13/43);
- finite RDFS cases inside the selected W3C profile (7/14);
- selected OWL 2 RL cases inside the selected W3C profile (9/18); and
- operational surfaces deliberately selected within those domain rows.

The result classifies 70 scenarios as agreement, four as W3C-overrides-Jena,
one as a W3C-permitted divergence, one as a Jena extension, and zero as
unsupported. The permitted divergence records `CLEAR GRAPH` implementation
freedom expressly allowed by SPARQL 1.2; it is not a failed scenario. G0.3
refreshed subject
`182972ecb68f5d6e3868fa30bb44b860d50da6c135f2cc50e4236a2eb5876a63`;
two complete runs produced byte-identical receipt SHA-256
`7209da6a1610f4f5252de97d13f75b46483b88f8f8a754d0d30170a92b6c401e`.
This closes the reviewed intersection only. Any broader Apache Jena claim
requires a new versioned, set-equal scenario inventory.

## Agentic-QE evidence procedure

The Oxigraph-owned adapter requests Agentic-QE's `latest` dist-tag, verifies
that the installed CLI version matches the exact version in the
integrity-bearing lockfile resolution, and records the lock SRI, package
metadata, version, and executable hash. The current lockfile resolves 3.13.12.
Agentic-QE is not a Rust oracle. The adapter adversarial suite currently passes
19/19.

```bash
cd tools/agentic-qe
npm ci --ignore-scripts
npm run test:parity
```

The adapter verifies the exact package, uses shell-free commands and locked
dependencies, scans complete output for exact counts, contains canonical paths,
kills process groups on timeout, and writes atomic receipts. It serializes all
profiles behind one repository lease, executes commands in reviewed order, and
requires set- and order-equal completion: the MetaHarness gate has 41 commands
and the aggregate parity profile has 47. Schema-v4 receipts preserve declared
outputs in content-addressed per-profile archives and publish exact
receipt/oracle bytes in UUID-addressed directories; the oracle binds the exact
receipt bytes and run UUID.

Generated candidates remain outside source. They enter the implementation only
after path audit, standards review, compilation, native suites, conformance
suites, mutation competence, and adversarial review.

## MetaHarness and Darwin procedure

MetaHarness requests `@metaharness/darwin` from the `latest` dist-tag; the
current integrity-bound lockfile resolves 0.9.3. Darwin may change only its
seven policy surfaces; implementation, specifications, pins, manifests,
expected results, profiles, exclusions, limits, and evidence definitions are
protected. Every dependency refresh invalidates prior qualification receipts
until the newly resolved bytes pass the same gates.
The protected snapshot includes root `README.md` plus ADR, plan, research,
product, evaluator, and workflow surfaces. It excludes only the
repository-relative generated output `js/pkg`; JavaScript source and every
other `pkg` directory remain protected, and a symlink at that path still fails
closed.

```bash
cd tools/metaharness
npm ci --ignore-scripts
npm run qualify:synthetic
npm run qualify
```

Qualification order:

1. hash the protected source and oracle set;
2. run two seeded synthetic evolutions to prove bounded policy mechanics;
3. reject an unsafe mutation probe;
4. generate the baseline harness;
5. execute the exact ordered 41-command `metaharness-semantic-gate` through the
   real shell-free sandbox; Java-backed lanes re-enter the pinned shared Jena
   toolchain because Darwin intentionally removes `JAVA_HOME`;
6. require solve, regression, safety, cost, and reproducibility;
7. replay from a clean process; and
8. verify protected inputs did not change.

Synthetic success never substitutes for step 5. Harness effort stays below 20%
and two hours before review; primary semantic artifacts always take priority.

## Final qualification sequence

Run from a clean, pinned toolchain state:

1. workspace format and dependency-lock checks;
2. targeted strict Clippy, native tests, Rustdoc, and WASM/i686 checks;
3. RDF 1.2, SPARQL 1.2, RDF Dataset Canonicalization, RDFS, OWL, and SHACL
   official or explicitly classified supporting lanes;
4. Jena 6.1.0 and Soufflé 2.5 required differentials;
5. reopen the G0.6 OxDatalog schema-v3 receipt, native outcomes, and policy copy
   from immutable run `731e6467-2cab-4260-8d15-b34e4ebc8ed6` after confirming
   its protected snapshot is still current (358 generated, 278 caught,
   80 unviable, zero missed/timeouts); regenerate it after any protected drift;
6. Agentic-QE parity receipt;
7. MetaHarness/Darwin full qualification;
8. adversarial review of path, receipt, resource, transaction, and claim
   boundaries;
9. JSON, ADR, and local-link validation; and
10. reproduce all content hashes from a clean process.

Any source, lockfile, oracle, manifest, profile, or count change invalidates
downstream receipts and restarts from the earliest affected step.

## Remaining closure backlog

1. Replace the 79 grouped obligations spanning all 11 RDF, 12 SPARQL, and
   8 SHACL documents with a sentence-level normative extraction; retain stable
   IDs and assign reviewed evidence or an explicit disposition to every clause.
2. Close the two invalid upstream SHACL fixtures and complete normative-clause
   mapping around the executed supplemental 171-case Rules lane and informative
   32-pair SHACL-C lane. Preserve the open RDF Rules mapping, concrete
   body-abbreviation, FOR/IN issue 1074, repeated-firing issue 1069, and
   blank-node body-matching dispositions until the drafts supply stable
   normative answers.
3. Implement or explicitly reject every remaining SPARQL protocol, service,
   federation, result-format, update, graph-store, and entailment interface
   requirement.
4. Establish Rust, Python, JavaScript, CLI, and HTTP agreement wherever a
   capability is public.
5. Define and review any desired Jena capability scope beyond the closed
   76-scenario/198-assertion outcome intersection before expanding its matrix.
6. Add edge-lane drift automation and reviewed baseline advancement.
7. Add platform reproducibility evidence for Linux, macOS, and Windows.

## Definition of done

The ultimate goal is complete only when:

- `jena-12-compat` has a closed scenario inventory;
- `rdf12-w3c`, `sparql12-w3c`, and `shacl12-w3c` each have a closed applicable
  normative ledger and green exact receipts;
- `w3c-12-full` is derived from those three compatible profiles;
- Datalog, RDFS, and OWL claims remain inside their named bounded scopes;
- all final mutation, differential, Agentic-QE, Darwin, and adversarial gates
  pass without protected-input changes; and
- no documentation or API makes a claim broader than its receipt.
