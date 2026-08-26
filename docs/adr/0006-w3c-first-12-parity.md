# ADR-0006: W3C-first RDF, SPARQL, and SHACL 1.2 parity

- **Status**: Accepted
- **Date**: 2026-07-26
- Deciders: Oxigraph parity programme
- **Amends**:
  [ADR-0001 — Outcome-oriented Apache Jena parity](0001-outcome-oriented-jena-parity.md)
  and
  [ADR-0003 — W3C 1.2 conformance baseline](0003-w3c-12-conformance-baseline.md)
- **Related**:
  [ADR-0007 — OWL 2 RL over Datalog](0007-owl-profiles-over-datalog.md),
  [ADR-0008 — SHACL processor profiles](0008-shacl-processor-profiles.md)

## Context

The programme must first reproduce useful Apache Jena outcomes and then exceed
that compatibility baseline where current W3C 1.2 drafts require more. Jena
6.1.0 is a reference implementation, not the owner of RDF, SPARQL, or SHACL
semantics.

Published snapshots and editor drafts move independently. A current target and
a reproducible claim therefore need separate lanes.

## Decision

Adopt two delivery tranches and W3C-first authority.

### Tranche A: version-pinned Jena compatibility

`jena-12-compat` covers only enumerated behavior at the intersection of Jena
6.1.0, a selected W3C snapshot, and an exposed Oxigraph interface. Differential
agreement is compatibility evidence, not W3C conformance.

### Tranche B: independently receipted W3C families

| Profile | Required authority set |
|---|---|
| `rdf12-w3c` | Concepts, Semantics, Schema, N-Triples, N-Quads, Turtle, TriG, RDF/XML, and applicable interoperability requirements |
| `sparql12-w3c` | Query, Update, Service Description, Federated Query, result formats, Entailment Regimes, Protocol, and Graph Store Protocol |
| `shacl12-w3c` | Core, SPARQL Extensions, Node Expressions, Rules, and separately scoped UI, Profiling, and Compact Syntax contracts |

Informative overview, primer, and “What’s New” documents remain inventoried but
do not become processor requirements by themselves.

When evidence disagrees, authority order is:

1. selected normative W3C text;
2. approved official W3C tests interpreted against that text;
3. supplementary tests for uncovered requirements;
4. Jena within its named compatibility scope; and
5. local implementation precedent.

## Claim gate

The [machine-readable conformance ledger](../research/conformance-ledger.json)
is the claim boundary. The
[normative requirements inventory](../research/normative-requirements.json)
maps all 31 registered family documents to stable grouped obligations and
explicit dispositions; it remains non-claimable until sentence-level
enumeration is complete. Each family must establish set equality between its
applicable normative requirements and reviewed dispositions.

Full family parity requires:

- no applicable `unsupported`, `blocked-upstream`, or `draft-unclear` item;
- all approved applicable official tests;
- supplementary positive, negative, adversarial, and mutation evidence;
- deterministic receipts;
- agreement across every interface that exposes the capability;
- bounded time, memory, recursion, cancellation, and output; and
- exact specification, test, source, feature, command, and platform provenance.

`w3c-12-full` additionally requires all three family profiles for the same RDF
term model and compatible snapshot.

## Current result classification

The following statements are allowed:

- “575 of 575 tests passed at the pinned RDF 1.2 official-suite revision.”
- “269 of 269 tests passed at the pinned SPARQL 1.2 official-suite revision.”
- “98 of 98 OWL 2 RL/RDF assertions passed across 68 applicable RDF-based
  cases.”
- Exact dated SHACL feature-set and approved-suite counts recorded in the
  conformance ledger.
- Exact Jena and Soufflé fixture agreement recorded in their receipts.

The following remain prohibited:

- “full Jena parity”;
- “RDF 1.2 parity” or “SPARQL 1.2 parity” based only on suite results;
- “SHACL 1.2 parity” for dated subsets;
- unqualified “OWL support”; and
- “W3C 1.2 parity”.

The official RDF and SPARQL suites are fully green, but the clause-level
normative inventories and cross-interface contracts are not complete. The
umbrella parity goal is therefore open.

## Moving-draft policy

The reviewed lane uses immutable publications or exact commits. The edge lane
resolves current heads, classifies clause, grammar, vocabulary, and test drift,
and opens a reviewed advancement item. Edge results cannot change release
expectations automatically.

Advancement requires a human-readable diff, updated requirement mapping,
reviewed expectations, and green native receipts.

## Consequences

- Jena remains useful without becoming the standards ceiling.
- Suite completion and normative completion cannot be conflated.
- Draft currency and release reproducibility coexist.
- Full-family work is larger than parser/query or SHACL Core test work.

## Alternatives rejected

- Stop at Jena parity: reference behavior is not standards authority.
- Follow editor branches directly in release CI: irreproducible.
- Target only dated TR pages: fails the current-draft goal.
- Use a single aggregate percentage: hides family and interface gaps.

## Evidence

- [Standards registry](../research/standards-registry.json)
- [Normative requirements inventory](../research/normative-requirements.json)
- [Conformance ledger](../research/conformance-ledger.json)
- [Apache Jena releases](https://jena.apache.org/download/)
- [RDF 1.2 Concepts](https://www.w3.org/TR/rdf12-concepts/)
- [SPARQL 1.2 Query](https://www.w3.org/TR/sparql12-query/)
- [SHACL 1.2 Core](https://www.w3.org/TR/shacl12-core/)

## Acceptance boundary

This ADR defines the terminal goal; it does not declare that goal achieved.
Only a closed requirement ledger and matching receipts may do so.
