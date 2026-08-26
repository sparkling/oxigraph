# ADR-0003: W3C 1.2 conformance baseline

- **Status**: Accepted
- **Date**: 2026-07-26
- Deciders: Oxigraph parity programme
- **Amended by**:
  [ADR-0006 — W3C-first 1.2 parity](0006-w3c-first-12-parity.md)
- **Related**:
  [ADR-0005 — Agentic-QE integration](0005-agentic-qe-integration.md),
  [ADR-0008 — SHACL processor profiles](0008-shacl-processor-profiles.md)

## Context

RDF 1.2, SPARQL 1.2, and SHACL 1.2 are evolving at different speeds. The
selected RDF publications include Candidate Recommendation Snapshots; SPARQL
and SHACL include Working Draft and editor-draft material. A floating `main`
branch is useful for drift detection but cannot define a reproducible release.

The official suites are valuable but not exhaustive. In particular, W3C SHACL
material warns that passing its tests does not prove complete specification
conformance.

## Decision

Maintain two evidence lanes:

1. A reviewed release lane pins specification revisions, test repositories,
   manifests, approval policy, exclusions, commands, features, and source.
2. An informational edge lane follows upstream heads and reports drift. It
   cannot alter release expectations or claims.

The canonical sources are listed in the
[standards registry](../research/standards-registry.json). The reviewed test
pins are:

| Source | Immutable revision |
|---|---|
| W3C RDF/SPARQL tests | `3d0b0613d0177d25aad7ec60e88df2338f461516` |
| W3C SHACL specifications/tests | `eedda09f93c39be1d2e978f3f942631494ae25a0` |
| W3C OWL 2 RL approved export | SHA-256 `af67cd7a007cbed8a54255d094a88f7304ec950457e13df58b51f507c6c29d00` |

Only approved SHACL tests may block a release. Proposed tests are
informational. Rejected tests run only as explicitly justified regressions.
Full report-graph comparison and boolean `sh:conforms` evidence remain distinct.

## Claim policy

Each applicable normative requirement must eventually be classified as
`pass`, `unsupported`, `not-applicable`, `blocked-upstream`, or
`draft-unclear`. A family parity claim requires no unresolved applicable item,
all applicable approved tests, supplementary tests for uncovered clauses,
cross-interface agreement, resource ceilings, and deterministic provenance.

The [normative requirements inventory](../research/normative-requirements.json)
currently represents all 31 registered RDF, SPARQL, and SHACL documents with
79 stable grouped obligations. It is not yet a sentence-level extraction.
Until that clause-level mapping is complete, the project may report an exact
official-suite result but not `RDF 1.2 parity`, `SPARQL 1.2 parity`, `SHACL 1.2
parity`, or `W3C 1.2 parity`.

## Current executable evidence

At the reviewed RDF/SPARQL pin:

| Suite | Passed | Failed | Unsupported |
|---|---:|---:|---:|
| RDF 1.2 official manifests | 575 / 575 | 0 | 0 |
| SPARQL 1.2 official manifest | 269 / 269 | 0 | 0 |
| RDF 1.2 Semantics subset within the RDF total | 77 / 77 | 0 | 0 |

The RDF total covers N-Triples syntax 29 and canonicalization 41; N-Quads
syntax 27 and canonicalization 41; Turtle syntax 74 and evaluation 29; TriG
syntax 35 and evaluation 25; RDF/XML 197; and RDF Semantics 77.

The consolidated SHACL execution discovers 521 cases and passes 519/519
eligible cases, with two hash-pinned invalid upstream validation fixtures
excluded:

| Lane | Passed | Authority and topology |
|---|---:|---|
| Root-reachable validation | 167 / 167 | Core/SPARQL validation lane |
| Root-reachable Node Expressions | 143 / 143 | Node-expression lane |
| Legacy `Infer` | 6 / 6 | Separate legacy rules compatibility lane |
| `manifest-rules.ttl` | 171 / 171 | Supplemental current-draft Rules lane; not root-reachable |
| SHACL Compact Syntax | 32 / 32 | Informative positive translation compatibility |

The W3C root manifest reaches validation, Node Expressions, and SPARQL
material, but not the separately invoked Rules manifest. The 32 SHACL Compact
Syntax fixtures are unmanifested positive examples from an editor-only draft.
Upstream supplies no normative negative corpus; local negative and round-trip
tests exist, and Jena 6.1.0 independently agrees on the same 32 positive graph
pairs. The native Rust matrices pass 167/167 tests with all features and
114/114 with default features disabled. These lanes therefore cannot be
collapsed into “519 approved conformance tests.” Exact lane counts,
classifications, and exclusions are maintained in the
[conformance ledger](../research/conformance-ledger.json).

The OWL lane inventories 70 approved RL cases, 68 marked RDF-based, and
executes 98 assertions from the RDF-based cases. All 98 pass. This is
OWL-profile evidence, not evidence for the RDF/SPARQL/SHACL aggregate.

## Consequences

- Public evidence is reproducible and status-qualified.
- Upstream drift cannot silently redefine a release.
- Missing tests remain visible as normative-ledger work.
- Pin advancement requires a reviewed requirements and expected-results diff.

## Alternatives rejected

- Gate on upstream `main`: irreproducible.
- Follow dated TR publications only: misses requested editor-draft currency.
- Treat every SHACL status as blocking: lets proposal churn redefine release.
- Equate a suite pass with conformance: overstates finite evidence.
- Fork complete upstream suites: increases drift and provenance risk.

## Evidence

- [RDF 1.2 Concepts](https://www.w3.org/TR/rdf12-concepts/)
- [RDF 1.2 Semantics](https://www.w3.org/TR/rdf12-semantics/)
- [SPARQL 1.2 Query](https://www.w3.org/TR/sparql12-query/)
- [SHACL 1.2 Core](https://www.w3.org/TR/shacl12-core/)
- [SHACL 1.2 Rules](https://www.w3.org/TR/shacl12-rules/)
- [W3C RDF/SPARQL tests](https://github.com/w3c/rdf-tests)
- [W3C Data Shapes tests](https://github.com/w3c/data-shapes)
- [W3C OWL 2 RL approved test export](https://www.w3.org/2009/11/owl-test/approved/profile-RL.rdf)

## Acceptance boundary

The baseline mechanism and official RDF/SPARQL suite lanes are implemented.
The family parity goal remains open until the machine-readable clause inventory
has set equality with the applicable normative requirements.
