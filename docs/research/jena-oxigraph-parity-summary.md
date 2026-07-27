# Apache Jena → Oxigraph capability parity

Status: historical pre-programme capability baseline  
Observed: 2026-07-26  
Ruflo programme goal: `task-1785068929720-qya1gy`

This document preserves the capability inventory captured before the semantic
implementation tranche. Its “absent,” “gap,” and roadmap labels describe that
baseline, not the current workspace. Current implementation and claim state is
authoritative only in the
[conformance ledger](conformance-ledger.json) and the
[semantic parity plan](../plans/semantic-parity-metaharness-plan.md).

Since this capture, bounded Datalog, RDFS, OWL 2 RL/RDF, and SHACL crates have
landed. The 31 outcomes across three fixtures described below were the initial
differential seed, not current evidence. The current immutable matrix contains
76 reviewed scenarios and 198 assertions across RDF 17/46, SPARQL 30/77, SHACL
13/43, finite RDFS 7/14, and selected OWL 2 RL 9/18
(scenarios/assertions). It classifies 70 scenarios as agreement, four as
W3C-overrides-Jena, one as a W3C-permitted divergence, one as a Jena extension,
and zero as unsupported. The permitted divergence records two distinct
successful outcomes that SPARQL 1.2 allows; it is not a failure. Its claim
limits are recorded in the
[current evidence summary](semantic-parity-current-summary.md). Neither result
is a parity percentage or a broad Jena claim.

## Executive decision

Treat Jena as a reference capability portfolio, not as an API to clone. Oxigraph
already covers the database core well. The programme should preserve its lean
Rust architecture, safety, embeddability, cross-language bindings, and standards
trajectory while adding the missing user outcomes behind explicit extension
contracts.

The historical 20-domain baseline is:

| State | Domains |
|---|---:|
| Strong overlap | 5 |
| Partial overlap | 5 |
| Absent in Oxigraph | 8 |
| Oxigraph advantage | 2 |

A single “parity percentage” is intentionally not reported. SHACL conformance,
an ontology convenience API, and a query builder are not interchangeable units.
Each domain needs its own supported profile, evidence, tests, risk budget, and
exit gate.

## What already overlaps strongly

- RDF terms, graphs, datasets, and transactional persistence
- RDF parsing and serialization, including JSON-LD in the current workspace
- SPARQL query, update, federation, result formats, and optimization
- SPARQL Protocol and Graph Store Protocol server behavior
- Embedded and persistent stores

Oxigraph also has differentiators worth protecting: Rust, Python, and
JavaScript/WASM surfaces; RDF dataset canonicalization; and preliminary RDF and
SPARQL 1.2 support.

## Material gaps

| Priority | Capability | Why it matters | Initial size |
|---|---|---|---|
| P0 | SHACL Core | Widely used validation outcome; enables safe ingest/update gates | L |
| P0 | RDFS inference | Foundation for semantic behavior and later ontology features | L |
| P0 | Extension and conformance harness | Prevents unsupported standards claims and regressions | M |
| P1 | Text index | High-value production query capability | L |
| P1 | RDF Patch/change feed | Replication, audit, and integration primitive | M |
| P1 | GeoSPARQL completion | Existing seam allows incremental standards slices | XL overall |
| P1 | Server modules/operations | Security, observability, and deployment depth | L |
| P2 | Ontology façade | Developer ergonomics over RDF/OWL structures | XL |
| P2 | ShEx | Alternative shape-validation workflow | L |
| P2 | RDFConnection-style façade | Common local/remote client workflow | M |
| P2 | Query builder | Programmatic query construction | S–M |
| P2 | Declarative assembler | Reproducible service composition | M–L |

Jena’s own documentation qualifies its OWL reasoners as useful but incomplete
OWL/Lite subsets and its ShEx implementation as lacking semantic actions and
`EXTERNAL`. “Parity” must therefore reproduce documented outcomes and
limitations, not imply stronger standards support than the reference.

## First implemented slice: `geof:boundary`

GeoSPARQL 1.1 requires `geof:boundary`; Jena implements it, while the observed
Oxigraph `spargeo` inventory marked it missing. It was selected as the first
slice because it fits the existing extension seam and has a clear reference
case with low architectural blast radius.

The implementation:

- registers `http://www.opengis.net/def/function/geosparql/boundary` as
  GeoSPARQL function 44;
- matches Jena’s polygon reference case;
- returns polygon shells and holes as lineal boundaries;
- applies the Simple Features MOD-2 endpoint rule to line collections;
- returns an empty geometry collection for points;
- preserves WKT versus GeoJSON output datatype;
- rejects geometry collections as an evaluation error, matching Jena/JTS; and
- remains explicitly limited to the current `spargeo` CRS84 contract.

Verification:

| Check | Result |
|---|---|
| `cargo test -p spargeo` | pass — 33 tests |
| `cargo clippy -p spargeo --all-targets -- -D warnings` | pass |
| `cargo check -p spareval --features geosparql` | pass |
| `cargo check -p oxigraph-cli --features geosparql` | blocked by the pre-existing, uninitialized RocksDB submodule |

## Programme tranches and gates

1. **T0 — evidence and extension gates.** Build a cross-engine golden corpus,
   capability receipts, extension contracts, and performance/safety budgets.
   Exit only when every parity claim maps to primary evidence and executable
   tests.
2. **T1 — semantic minimum viable platform.** Deliver SHACL Core, an RDFS
   entailment MVP, and incremental GeoSPARQL functions. Unsupported profiles
   must fail closed.
3. **T2 — search, change, and service depth.** Add text indexing, RDF Patch,
   SHACL SPARQL, service modules, and observability. Gate on crash recovery,
   transaction isolation, authorization boundaries, and index consistency.
4. **T3 — ontology and developer ergonomics.** Add outcome-oriented ontology,
   connection, query-builder, configuration, and ShEx surfaces across Rust,
   Python, and JavaScript.
5. **T4 — advanced semantics.** Consider custom rules, explicitly scoped OWL
   profiles, broader CRS support, query rewrite, and spatial aggregates only
   with complexity and resource ceilings.

## Ruflo research receipt

RuvNet Brain pointed to Ruflo ADR-099’s provenance-first dossier method. The
programme used the shipped `ruflo-goals` workflows `goal-plan`,
`deep-research`, `dossier-collect`, `research-synthesize`, and `horizon-track`.
Persistent evidence is recorded in:

- `goals-research`
- `goals-research-sources`
- `goals-horizons`
- `goap-plans`
- `research-synthesis`
- `dossier`

The detailed graph artifact is
[`jena-oxigraph-parity-dossier.json`](jena-oxigraph-parity-dossier.json).

## Primary sources

- [Apache Jena 6.1.0 release](https://jena.apache.org/download/)
- [Apache Jena documentation inventory](https://jena.apache.org/documentation/index.html)
- [Jena architecture](https://jena.apache.org/about_jena/architecture.html)
- [Jena inference](https://jena.apache.org/documentation/inference/index.html)
- [Jena SHACL](https://jena.apache.org/documentation/shacl/)
- [Jena ShEx](https://jena.apache.org/documentation/shex/)
- [Jena Fuseki](https://jena.apache.org/documentation/fuseki2/)
- [Jena TDB2](https://jena.apache.org/documentation/tdb2/)
- [Jena GeoSPARQL](https://jena.apache.org/documentation/geosparql/)
- [OGC GeoSPARQL 1.1](https://docs.ogc.org/is/22-047r1/22-047r1.html)
- [Oxigraph repository and capability inventory](https://github.com/oxigraph/oxigraph)
- [Released Oxigraph 0.5.9 API documentation](https://docs.rs/oxigraph/latest/oxigraph/)
