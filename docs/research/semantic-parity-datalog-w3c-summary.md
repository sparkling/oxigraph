# Semantic parity research synthesis

Status: historical research synthesis; superseded for current evidence  
Observed: 2026-07-26  
Ruflo workflow: deep-research → dossier-collect → research-synthesize

> This document preserves the research path and early implementation snapshot.
> Counts and completion labels below are historical. Use the
> [current evidence summary](semantic-parity-current-summary.md),
> [conformance ledger](conformance-ledger.json), and
> [normative requirements inventory](normative-requirements.json) for current
> claims.

## Executive summary

The recommended semantic foundation is an Oxigraph-native Datalog crate with a
storage-independent rule IR, safety/stratification validation, semi-naive
fixpoint evaluation, resource ceilings, and provenance. A separate SHACL crate
owns validation semantics and reports, using the Datalog core for supported
SHACL Rules rather than forcing SHACL Core through Datalog.

Delivery now has two explicit tranches. First, match the RDF/SPARQL/SHACL 1.2
intersection supported by Jena 6.1.0. Then close the remaining requirements in
the current W3C RDF 1.2, SPARQL 1.2, and SHACL 1.2 editor drafts. Jena is the
first differential baseline; W3C is the terminal semantic authority.

The same Datalog substrate implements only OWL 2 RL/RDF. OWL 2 RL
compilation, profile checking, equality, datatypes, and inconsistency reporting
belong in a separate `oxowl` layer. Recognized unsupported vocabulary and
profile requests fail closed; a complete structural-syntax profile checker is
not claimed.

Correctness stays with native Rust tests and pinned W3C manifests. Agentic-QE
3.13.2 is useful as a pinned coordinator and candidate generator, but its
current Rust execution and MCP paths cannot be trusted as conformance oracles.
MetaHarness/Darwin enters only after the oracle and a production-shaped thin
slice are frozen.

## Implementation status on 2026-07-26

- `oxdatalog` now provides the D0 IR, validation, semi-naive evaluator,
  deterministic provenance/receipts, hard resource limits, cancellation, RDF
  1.2-preserving quad adapter, and `QueryableDataset` view.
- Its 58 native tests pass. OxDatalog matches Apache Jena 6.1.0 on two frozen
  D0 fixtures and Soufflé 2.5 on one stratified D1 fixture. Timeout,
  cancellation, boundedness, deterministic provenance, and RDF adaptation are
  native-test surfaces. A final full-source D0–D2 mutation receipt remains a
  release gate.
- `oxrdfs` exposes a finite active-vocabulary RDFS 1.2 profile, typed rejection
  of a broader claim, 37 passing native tests, and 77 of 77 pinned RDF
  Semantics cases. One Jena 6.1.0 fixture also agrees on 10 entailed and four
  not-entailed assertions.
- `oxowl` exposes both the narrow compatibility seed and a bounded
  `owl2-rl-rdf` processor. Its inventory contains 78 RL/RDF rule identifiers:
  46 Datalog rules and 32 explicit specialized operators for equality,
  datatypes, lists, keys, chains, contradictions, and related RDF boundaries.
  Thirty-three native tests pass, including datatype value-space hardening;
  full OWL 2 RL/RDF conformance remains explicitly rejected.
- The official W3C approved RL export is pinned by SHA-256 and inventoried as
  70 cases, including 68 RDF-based cases. The applicable RDF-based lane passes
  98 of 98 assertions; this is execution evidence, not family conformance.
- Agentic-QE 3.13.2 coordinates exact profile-defined receipts through a
  shell-free adapter whose adversarial suite passes 13 of 13; Cargo, reference
  engines, and pinned W3C inputs remain the authorities. MetaHarness/Darwin
  0.8.0 has a synthetic qualification receipt only; a full semantic receipt is
  still required.

Across the three new reasoning crates, 113 native tests pass. Full Jena parity,
RDF/SPARQL/SHACL 1.2 parity, RDFS 1.2 entailment, and OWL 2 RL conformance are
not claimed.

## Key findings

### 1. W3C 1.2 is the target; Jena 1.2 is the first tranche — High evidence

The RDF 1.2 family identifies eleven documents, SPARQL 1.2 identifies twelve,
and SHACL 1.2 currently spans Core, SPARQL Extensions, Node Expressions, Rules,
UI, and Profiling plus note drafts. A Jena or test-suite pass cannot stand in
for a normative-requirement inventory across those families.

Use distinct `jena-12-compat`, W3C reviewed, and W3C editor-draft edge
receipts. The edge lane follows current upstream work; public claims use an
exact reviewed specification and test snapshot.

### 2. Oxigraph already has meaningful RDF/SPARQL 1.2 support — High evidence

The workspace has `rdf-12` and `sparql-12` feature flags and official W3C
manifest runners. At W3C commit `3d0b061…`, the current parity receipt passed
the native RDF, SPARQL parser/evaluator, GeoSPARQL, RDF 1.2, and SPARQL 1.2
profiles.

This corrects a naive “build 1.2 from zero” roadmap. The next work is explicit
profile coverage, semantics/entailment, negative cases, and reproducible
receipts.

### 3. SHACL is the highest-value Jena parity gap — High evidence

Jena exposes SHACL validation and integration. Oxigraph now has a separate
`oxshacl` crate for Core validation, report graphs, Node Expressions, SPARQL
constraints, and rules. The current reconciliation at W3C `data-shapes` commit
`eedda09f93c39be1d2e978f3f942631494ae25a0` discovers 521 cases and passes all
519 eligible cases across five separately classified lanes:
167 validation + 143 Node Expressions + 6 legacy SPARQL Rules `Infer` + 171
supplemental SRL Rules + 32 informative SHACL-C pairs. Two invalid upstream
fixtures are excluded by path, content hash, and reason. Native Rust passes
167/167 all-feature and 114/114 no-default tests, and Jena 6.1.0 agrees on all
32 SHACL-C pairs. This exact evidence still does not establish family parity.

SHACL Core does not require a full RDFS engine by default. Therefore SHACL Core
and inference should be separate modules with explicit entailment configuration.

### 4. SHACL Rules makes a real Datalog core strategically useful — High evidence

SHACL Rules requires explicit selection, condition, ordering, deactivation, and
rule-result semantics. Oxigraph uses the Datalog D1 path for supported typed
rules and a bounded SPARQL CONSTRUCT fixpoint for `sh:SPARQLRule`; validation
report semantics remain outside the Datalog engine.

Current-draft Rules is absent from the root manifest. The separate
171-case `manifest-rules.ttl` corpus is now inventoried and executed as 138
syntax, 8 well-formedness, 9 stratification, and 16 strict result-graph cases.
It is supplemental evidence because it is root-unreachable and has no
`mf:approval` value. Public `Infer` and `QUERY` operations are tested, but the
draft's placeholder RDF Rules mapping, concrete body-abbreviation mapping,
FOR/IN issue 1074, repeated-firing issue 1069, and blank-node body matching
remain explicit open dispositions.

### 5. OWL support is limited to OWL 2 RL — High evidence

OWL 2 RL was designed for rule-based implementation, and its RL/RDF rules fit
finite fixpoint evaluation. Add a separate `oxowl` compiler/profile layer plus
equality-aware indexing, datatypes, keys, RDF-list handling, contradiction
results, and provenance.

Jena's OWL Micro, Mini, and default modes are incomplete and remain
differential test sources only. Oxigraph will not expose them as profiles.
OWL 2 EL, QL, DL, Full, and unqualified OWL modes are outside the programme.

### 6. No current Rust Datalog crate is a complete runtime fit — High evidence

- Datafrog is the best small algorithmic building block, but not a rule runtime.
- Ascent and Crepe are compile-time macro systems, awkward for user-supplied
  runtime rules.
- Soufflé is mature but introduces a C++ runtime and portability mismatch.
- Cozo duplicates database responsibilities.

Use a public Oxigraph IR and an internal evaluator trait. Compare Datafrog and a
small native evaluator on one frozen slice. Keep Soufflé as an optional
differential oracle.

### 7. Jena reasoning is a profile portfolio, not one target — High evidence

Jena's `GenericRuleReasoner` supports forward, backward, and hybrid operation,
RETE/table-based engines, deductions graphs, built-ins, schema binding, and
derivation logging. The first Oxigraph profile should target deterministic
forward materialization, RDFS closure, provenance, and custom positive rules.
Backward/hybrid and broad built-in parity are deferred.

### 8. Agentic-QE needs a Rust authority adapter — High evidence

The installed npm release is 3.13.2. Its Rust generator works, but its executor
selects Vitest/Jest/Mocha and its MCP execute handler simulates outcomes.

An actual generation probe against `variable.rs` was rejected because it:

- prefixed generated code with a bare `rust` token;
- asserted that a digit-leading SPARQL variable is invalid when Oxigraph's
  grammar accepts it; and
- marked a quality gate passed while carrying an error-level issue.

The new adapter pins the package, executes Cargo/W3C commands, writes an honest
receipt, and structurally audits candidates. Native oracles remain authoritative.

### 9. Darwin is appropriate only outside the semantic boundary — High evidence

Shipped Darwin source allows seven policy mutation surfaces and applies solve,
regression, safety, cost, and reproducibility gates. This is suitable for
planner/reviewer/tool/memory/score policy improvement.

Darwin must never change source, W3C manifests, expected graphs, exclusions, or
resource ceilings. The harness budget is at most 20% of programme effort and two
hours before a real primary artifact.

## Contradictions resolved

| Tension | Resolution |
|---|---|
| “RDF/SPARQL 1.2 are future work” vs local source | They are already partially implemented and tested; profile completion is future work. |
| Agentic-QE says Rust generation/execution vs shipped executor | Generation exists; Cargo execution does not. Use the adapter. |
| Test suite pass vs full conformance | A pass supports tested behavior only; claims remain profile- and status-qualified. |
| Use a Datalog crate vs build one | Own the public IR; spike Datafrog internally; do not leak a backend. |
| SHACL via rules vs dedicated validator | Dedicated `oxshacl` for Core/reporting, shared `oxdatalog` for inference/Rules. |
| Jena parity vs current W3C parity | Deliver Jena compatibility first, then close W3C-only requirements; W3C wins conflicts. |
| Datalog means full OWL support | Use it only for OWL 2 RL/RDF; keep its vocabulary in `oxowl` and fail closed for recognized unsupported profile requests without claiming a complete structural checker. |

## W3C evidence horizon

| Surface | Current status | Gate policy |
|---|---|---|
| RDF 1.2 Concepts/Semantics | Candidate Recommendation Snapshot, 2026-04-07 | pinned release gate |
| SPARQL 1.2 Query | Working Draft, 2026-06-25 | experimental named profile |
| SPARQL 1.2 Entailment | Working Draft, 2026-04-09 | later named profile |
| SHACL 1.2 Core | Working Draft, 2026-07-23 | approved tests, pinned |
| SHACL 1.2 Node Expressions | Working Draft, 2026-07-21 | post-Core named profile |
| SHACL 1.2 SPARQL Extensions | Working Draft, 2026-07-24 | post-Core named profile |
| SHACL 1.2 Rules | Working Draft, 2026-07-25 | Datalog D2, pinned |
| OWL 2 RL | Recommendation | separate `oxowl` rule profile |
| RDF Dataset Canonicalization 1.0 | Recommendation | receipt/report normalization |
| RIF Core | Recommendation | later interchange compatibility |

## Immediate actions

1. Replace the 79 grouped obligations spanning all 31 registered RDF, SPARQL,
   and SHACL documents with a sentence-level normative extraction and
   supplemental evidence for every untested clause.
2. Expand `jena-12-compat` beyond its current two Datalog and one finite RDFS
   fixtures, and finish the full-source D0–D2 mutation receipt with zero
   survivors and timeouts.
3. Close unrestricted RDFS datatype/generalized-semantics decisions and SPARQL
   entailment-regime integration without broadening the bounded public profile.
4. Complete OWL conformance clauses outside the executed RDF-based export,
   library imports policy, and declared datatype boundaries.
5. Resolve or rebase the two invalid SHACL fixtures, close the open mappings
   around the executed 171-case supplemental Rules manifest, and then close
   Core, Node Expressions, SPARQL, Rules, UI, Profiling, and optional Compact
   Syntax requirements separately.
6. Keep Agentic-QE optional and native/reference oracles authoritative.
7. Produce a full MetaHarness/Darwin semantic qualification and clean replay
   without allowing policy evolution to mutate protected semantic inputs.

## Evidence quality and limitations

High findings are directly supported by local source/tests plus official
specification or project source. Candidate-engine recommendations are design
judgments based on current crates and must be confirmed by the D0 spike.

The SHACL specifications are Working Drafts and may change. The pinned W3C
snapshot is both inventoried and executable through the strict runner,
including the separately classified supplemental Rules manifest. Its green
named lanes still do not cover every normative clause. The goal is complete
current-draft parity, but no such claim is made until every applicable
normative requirement and family gate passes.

## Sources

- [RDF 1.2 Concepts](https://www.w3.org/TR/rdf12-concepts/)
- [RDF 1.2 Semantics](https://www.w3.org/TR/rdf12-semantics/)
- [SPARQL 1.2 Query](https://www.w3.org/TR/sparql12-query/)
- [SPARQL 1.2 Entailment](https://www.w3.org/TR/sparql12-entailment/)
- [SHACL 1.2 Core](https://www.w3.org/TR/shacl12-core/)
- [SHACL 1.2 Node Expressions](https://www.w3.org/TR/shacl12-node-expr/)
- [SHACL 1.2 SPARQL Extensions](https://www.w3.org/TR/shacl12-sparql/)
- [SHACL 1.2 Rules](https://www.w3.org/TR/shacl12-rules/)
- [OWL 2 Profiles](https://www.w3.org/TR/owl2-profiles/)
- [OWL 2 Conformance](https://www.w3.org/TR/owl2-conformance/)
- [W3C RDF tests](https://github.com/w3c/rdf-tests)
- [W3C data-shapes tests](https://github.com/w3c/data-shapes)
- [RIF Core](https://www.w3.org/TR/rif-core/)
- [Jena inference](https://jena.apache.org/documentation/inference/index.html)
- [Agentic-QE 3.13.2 registry record](https://registry.npmjs.org/agentic-qe/3.13.2)
- [Datafrog source](https://github.com/rust-lang/datafrog)
- [Ascent source](https://github.com/s-arash/ascent)
- [Soufflé](https://souffle-lang.github.io/)
