# Semantic parity programme — current evidence summary

Status: scoped schema-v5 Agentic-QE receipts are independently reopened, but
the aggregate Agentic receipt, full current-HEAD qualification, and broad
parity claims are withheld
Evidence cut: 2026-07-26 normative baseline; dependency reconciliation:
2026-08-31

## Bottom line

Oxigraph has sealed, executable, bounded evidence for RDF/SPARQL 1.2 syntax and
query behavior, RDF Dataset Canonicalization, finite RDFS, OWL 2 RL/RDF,
SHACL feature lanes, Datalog D0–D2, and a reviewed Apache Jena outcome
intersection. These results establish only the named tested surfaces.

G0.3 seals the reviewed Jena profile to subject `182972ec...` with two
byte-identical 76/198 runs. G0.4-G0.5 keep the exact 144/129 CLI and historical
then-34-test persistence-write inventories source-bound; the current source
inventory contains 45 executed tests. At tracked-clean subject `5a93890f`,
schema-v5 adapter, persistence, and G1 runs pass 40/40, 45/45, and 66/66 and
were independently reopened. Their broad dirty flag records only protected
untracked Ruflo/runtime paths. This establishes current scoped evidence, not
the unrun 47-command aggregate Agentic receipt. G0.6's generic
OxDatalog run remains bounded to its own source/runtime scope. Full MetaHarness
qualification plus independent verification have not been regenerated, so no
umbrella current-HEAD qualification follows.

They do **not** establish Apache Jena parity, RDF 1.2 parity, SPARQL 1.2 parity,
SHACL 1.2 parity, OWL family conformance, or aggregate W3C 1.2 parity. The
normative inventory still contains 79 grouped obligations rather than a
sentence-level enumeration: 29 pass, 41 unsupported, 6 not applicable,
1 blocked upstream, and 2 draft-unclear. Clause enumeration and cross-interface
closure remain incomplete.

## Last sealed exact executable evidence

| Surface | Last sealed bounded result | Claim boundary |
|---|---:|---|
| OxDatalog D0–D2 | 70 native tests pass; current G0.6 run has 358 mutants generated, 278 caught, 80 unviable, 0 missed, 0 timed out | Generic D0-D2 source/runtime-bound mutation gate closed with 100% of viable mutants caught; no persistence-write or umbrella authority |
| Semantic store integration | 4 integration tests pass | Stable-snapshot public profile integration only |
| RDF 1.2 official manifests | 575/575 pass | Exact pinned suite, not full family parity |
| SPARQL 1.2 official manifest | 269/269 pass | Does not cover every protocol, service, federation, entailment, or result-format obligation |
| RDF Dataset Canonicalization 1.0 | 86/86 pass | Supporting specification, not RDF 1.2 family parity |
| RDF 1.2 Semantics aggregate | 77/77 pass: 24 Simple-, 27 RDF-, and 26 RDFS-regime cases | Exact pinned aggregate, not an RDFS-only or family-parity receipt |
| Finite RDFS profile | 37 native tests pass; the 26 RDFS-regime cases above pass | Oxigraph's `rdfs` feature is always the 15-pattern RDF 1.2 finite active-vocabulary profile; only direct `oxrdfs` use without `rdf-12` exposes the separate 14-pattern Basic profile |
| OWL 2 RL/RDF | 98/98 assertions across 68 RDF-based cases | Exact 78-rule inventory: 46 Datalog rules and 32 specialized operators |
| SHACL 1.2 evidence lanes | 521 discovered; 519/519 eligible cases pass; 2 invalid upstream exclusions; Rust 167/167 all-feature and 114/114 no-default tests; Jena SHACL-C 32/32 | Five separately classified lanes; synchronous WebAssembly SPARQL-backed validation fails closed because cooperative timeout/cancellation cannot be guaranteed; no family-parity claim |
| Apache Jena 6.1.0 differential | 76 scenarios and 198 assertions | Reviewed outcome intersection only; one distinct successful outcome is a W3C-permitted implementation variant |
| Agentic-QE `latest` (lock-resolved 3.13.12) adapter | 40/40 adversarial tests and schema-v5 contract; source-bound 144/129 CLI; independently reopened adapter 40/40, persistence 45/45, and G1 66/66 receipts at `5a93890f`; exact ordered 41-command Meta gate and 47-command parity definitions | Current scoped evidence only; protected untracked runtime paths set the broad dirty bit, the aggregate profile is unrun, and the adapter is never the semantic oracle |
| MetaHarness/Darwin `latest` (lock-resolved 0.9.3) | Full semantic-mode runner plus independent verification | No qualification result exists unless both current receipts verify against the same protected snapshot; never a semantic oracle |

The Jena matrix classifies 70 scenarios as agreement, 4 as
W3C-overrides-Jena, 1 as a W3C-permitted divergence, 1 as a Jena extension,
and 0 as unsupported. Domain totals (scenarios/assertions) are RDF 17/46,
SPARQL 30/77, SHACL 13/43, finite RDFS 7/14, and selected OWL 2 RL 9/18.
The permitted divergence is the `CLEAR GRAPH` topology variant expressly
allowed by SPARQL 1.2; it is neither an override nor a conformance failure.
The immutable profile closes that reviewed intersection, not the larger Apache
Jena capability portfolio.

The current scoped G0.3 profile is
`jena-6.1.0-outcome-intersection-2026-07-27-v1`. Two complete runs produced
byte-identical evidence with subject SHA-256
`182972ecb68f5d6e3868fa30bb44b860d50da6c135f2cc50e4236a2eb5876a63`
and receipt SHA-256
`7209da6a1610f4f5252de97d13f75b46483b88f8f8a754d0d30170a92b6c401e`.
The original July subject and receipt remain historical evidence only.

The current scoped G0.6 mutation evidence is immutable run
`731e6467-2cab-4260-8d15-b34e4ebc8ed6`, with receipt SHA-256
`fc0ec6dbb0c8dec0b3c9e2d58814372c8feebc8ec291528df1fdf432879b2ba5`,
content hash
`88de934ca8eba02ac985ab7bab25e7ea98d8b5412ecfcb623261b27e7cfec308`,
and protected input hash
`9898ef56c90cbcd8eef9cd490c2d63c9ed42a9a96c5ccab39d99ba834d707c3d`.
Its native outcomes contain one successful baseline, 358 unique mutants,
zero survivors, and zero timeouts under `cargo-mutants` 27.1.0. Later changes
to its protected OxDatalog roots reopen this evidence.

## SHACL evidence topology

The 519 eligible total is an arithmetic summary, not one W3C root-suite
total. The five lanes discover 521 cases and exclude two hash-pinned invalid
upstream validation fixtures:

| Lane | Passed | Authority |
|---|---:|---|
| Root-reachable validation | 167 | Pinned suite behavior; 2 invalid upstream fixtures excluded by path, hash, and reason |
| Root-reachable node expressions | 143 | Pinned suite behavior |
| Legacy SPARQL Rules `Infer` | 6 | Compatibility lane |
| Separate `manifest-rules.ttl` | 171 | Executable supplemental Rules lane: 138 syntax, 8 well-formedness, 9 stratification, and 16 result-graph cases; not root-reachable and no `mf:approval` value |
| SHACL-C source/graph pairs | 32 | Positive informative translation compatibility; editor-only and unmanifested; upstream supplies no normative negative corpus, while local negative/round-trip tests and a 32/32 Jena 6.1.0 differential are green |

This topology prevents supplemental Rules and informative SHACL-C evidence from
being presented as normative root-manifest coverage.

## Reviewed source pins

| Source | Reviewed revision | Role |
|---|---|---|
| W3C RDF/SPARQL tests | `3d0b0613d0177d25aad7ec60e88df2338f461516` | RDF 1.2 and SPARQL 1.2 official manifests |
| W3C Data Shapes | `eedda09f93c39be1d2e978f3f942631494ae25a0` | SHACL specifications and test inputs |
| W3C RDF Canonicalization | `15619df2fda7a4ca88308733789b6774517f9638` | RDF Dataset Canonicalization 1.0 |
| JSON-LD API | `92f07705a0c0ac27aa9bc6fe1322dcc9fad0114d` | Supporting JSON-LD 1.1 interchange |
| JSON-LD Streaming | `64e6fea9eee3cf5d80468810552f50f6c487925f` | Supporting streaming interchange |
| Notation3 | `8a9ea8ed42ae0487b20803f5687017980bbe8e37` | Current dependency-maintenance pin for the optional Community Group draft profile; the last semantic receipt remains bound to `b975fc59ab5d2ad2d28e7206f1c34c716977d2ad` |

JSON-LD API and Streaming evidence does not establish RDF 1.2 triple-term
parity. Notation3 is an optional Community Group draft profile, not a W3C
Recommendation-track RDF 1.2 surface. JSON-LD Framing is not pinned and is
explicitly unsupported/out of programme scope.

The N3 pin moved from `b975fc59ab5d2ad2d28e7206f1c34c716977d2ad`
to `8a9ea8ed42ae0487b20803f5687017980bbe8e37` only for the independently
reviewed development-dependency and generated-grammar repair. The bounded
[maintenance receipt](n3-dependency-maintenance-receipt.json) records audit
zero, deterministic ANTLR 4.13.2 and Webpack 5.110.2 outputs, Node 20/current
build gates, and the npm 9 expired-key false rejection together with passing
current-npm and independent ECDSA verification. It grants no semantic,
production, qualification, promotion, publication, or readiness authority.
The earlier 208/871/296 supporting-suite result remains historical evidence
for `b975fc59ab5d2ad2d28e7206f1c34c716977d2ad`; it has not been rerun or
relabeled for the new pin.

The selected N3 commit is not reachable from its configured origin at this
checkpoint. This parent integration is local-only: separately authorized
submodule publication must occur before any parent commit carrying the new
Gitlink is pushed or published.

The reviewed Data Shapes suite-content SHA-256 is
`1d2c1c40769da1cf63fef62f3029447a66b5e81b5744b4cf2eaa5e128ba51a3a`.
The five specification hashes are recorded exactly in the
[standards registry](standards-registry.json) and checked by the programme
evidence verifier.

## Supporting-suite gaps

The exact supporting parser lane passes 5/5 wrappers, with explicit bounded
dispositions:

- At historical pin `b975fc59ab5d2ad2d28e7206f1c34c716977d2ad`,
  N3 passed 208 parser, 871 extended, and 296 Turtle cases. Its two 87-entry
  reasoner manifests were unsupported because no reasoner handler/wrapper was
  registered. No corresponding semantic receipt exists yet for the current
  dependency-maintenance pin.
- JSON-LD ToRDF has 467 entries: 446 pass and 21 are declared exclusions.
- JSON-LD Streaming has 483 physical entries and 481 unique IDs. Four physical
  entries belonging to duplicate IDs `t0124` and `t0125` are quarantined by a
  fail-closed preflight. The stable 479-entry lane contains 452 passes and 27
  declared failures.
- JSON-LD FromRDF is not automated. The generic manual audit passes 9 of 54 and
  fails 45 of 54; the current or changed `t0027` and `t0028` cases both fail.

These are supporting interchange and optional-profile results. Their open
failures cannot be hidden by the green wrapper count or promoted into RDF 1.2
parity.

## What remains before broad claims

1. Replace grouped requirements with a complete applicable normative-clause
   inventory for all 11 RDF, 12 SPARQL, and 8 SHACL documents.
2. Close all applicable unsupported, blocked, and draft-unclear dispositions,
   including SPARQL protocol and service surfaces and SHACL UI/Profiling.
3. Prove Rust, Python, JavaScript, CLI, and HTTP agreement wherever a
   capability is public.
4. Keep the full MetaHarness/Darwin receipt and its independent verification
   current after every protected-input change. No current full receipt exists
   at this checkpoint, and neither receipt can close a normative gap on its
   own.
5. Advance reviewed draft pins only through an explicit drift review.

G1.7 compatibility/performance evidence and its human promotion decision are a
separate product gate. They cannot be inferred from semantic qualification or
from the scoped G0 receipts above.

## Canonical references

- [Standards and source registry](standards-registry.json)
- [Machine-readable conformance ledger](conformance-ledger.json)
- [Normative requirements inventory](normative-requirements.json)
- [Implementation and qualification plan](../plans/semantic-parity-metaharness-plan.md)
- [Current visual programme report](semantic-parity-programme.html)

The earlier Jena baseline and research syntheses remain historical inputs. They
must not be used as current evidence receipts.
