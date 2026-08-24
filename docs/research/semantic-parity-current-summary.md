# Semantic parity programme — current evidence summary

Status: last sealed bounded implementation evidence is green; current-HEAD
qualification is stale and broad parity claims are withheld
Evidence cut: 2026-07-26; reconciled: 2026-08-25

## Bottom line

Oxigraph has sealed, executable, bounded evidence for RDF/SPARQL 1.2 syntax and
query behavior, RDF Dataset Canonicalization, finite RDFS, OWL 2 RL/RDF,
SHACL feature lanes, Datalog D0–D2, and a reviewed Apache Jena outcome
intersection. These results establish only the named tested surfaces.

They are not current-HEAD qualification after the backend-neutral write work.
The Jena profile seals subject `1fe53cef...`, while the current subject is
`997e2579...`; Agentic-QE also expects 133/116 CLI tests while current exact
default/no-default inventories contain 144/129. The Jena, Agentic aggregate,
mutation, and full MetaHarness receipts must therefore be regenerated through
their reviewed fail-closed workflows before being called current.

They do **not** establish Apache Jena parity, RDF 1.2 parity, SPARQL 1.2 parity,
SHACL 1.2 parity, OWL family conformance, or aggregate W3C 1.2 parity. The
normative inventory still contains 79 grouped obligations rather than a
sentence-level enumeration: 29 pass, 41 unsupported, 6 not applicable,
1 blocked upstream, and 2 draft-unclear. Clause enumeration and cross-interface
closure remain incomplete.

## Last sealed exact executable evidence

| Surface | Last sealed bounded result | Claim boundary |
|---|---:|---|
| OxDatalog D0–D2 | 70 native tests pass; 358 mutants generated, 278 caught, 80 unviable, 0 missed, 0 timed out | Full-source mutation gate closed for its sealed source snapshot with 100% of viable mutants caught; current binding open |
| Semantic store integration | 4 integration tests pass | Stable-snapshot public profile integration only |
| RDF 1.2 official manifests | 575/575 pass | Exact pinned suite, not full family parity |
| SPARQL 1.2 official manifest | 269/269 pass | Does not cover every protocol, service, federation, entailment, or result-format obligation |
| RDF Dataset Canonicalization 1.0 | 86/86 pass | Supporting specification, not RDF 1.2 family parity |
| RDF 1.2 Semantics aggregate | 77/77 pass: 24 Simple-, 27 RDF-, and 26 RDFS-regime cases | Exact pinned aggregate, not an RDFS-only or family-parity receipt |
| Finite RDFS profile | 37 native tests pass; the 26 RDFS-regime cases above pass | Oxigraph's `rdfs` feature is always the 15-pattern RDF 1.2 finite active-vocabulary profile; only direct `oxrdfs` use without `rdf-12` exposes the separate 14-pattern Basic profile |
| OWL 2 RL/RDF | 98/98 assertions across 68 RDF-based cases | Exact 78-rule inventory: 46 Datalog rules and 32 specialized operators |
| SHACL 1.2 evidence lanes | 521 discovered; 519/519 eligible cases pass; 2 invalid upstream exclusions; Rust 167/167 all-feature and 114/114 no-default tests; Jena SHACL-C 32/32 | Five separately classified lanes; synchronous WebAssembly SPARQL-backed validation fails closed because cooperative timeout/cancellation cannot be guaranteed; no family-parity claim |
| Apache Jena 6.1.0 differential | 76 scenarios and 198 assertions | Reviewed outcome intersection only; one distinct successful outcome is a W3C-permitted implementation variant |
| Agentic-QE `latest` (lock-resolved 3.13.12) adapter | 18/18 adversarial tests; exact ordered 41-command Meta gate and 47-command parity profiles | Sequential, repository-leased coordinator and receipt recorder; never the semantic oracle |
| MetaHarness/Darwin `latest` (lock-resolved 0.9.3) | Full semantic-mode runner plus independent verification | No qualification result exists unless both current receipts verify against the same protected snapshot; never a semantic oracle |

The Jena matrix classifies 70 scenarios as agreement, 4 as
W3C-overrides-Jena, 1 as a W3C-permitted divergence, 1 as a Jena extension,
and 0 as unsupported. Domain totals (scenarios/assertions) are RDF 17/46,
SPARQL 30/77, SHACL 13/43, finite RDFS 7/14, and selected OWL 2 RL 9/18.
The permitted divergence is the `CLEAR GRAPH` topology variant expressly
allowed by SPARQL 1.2; it is neither an override nor a conformance failure.
The immutable profile closes that reviewed intersection, not the larger Apache
Jena capability portfolio.

The sealed profile is
`jena-6.1.0-outcome-intersection-2026-07-27-v1`. Two complete runs produced
byte-identical evidence with subject SHA-256
`1fe53cef38fb579188b61f1ccd60c383b1098c922012753733c4ef9c154b095d`
and receipt SHA-256
`48673fdb0540dfe3a41a8c624f6ce98f31fe39a06e193007a5f84db3df005c76`.

The final full-source mutation receipt is valid for its frozen library and
mutation-policy inputs, not current HEAD. Immutable run
`5c7397b1-881e-4548-a5f5-f978da254bde` has receipt SHA-256
`ad3dba338080e1f748570aba6c6a8ecec495bd1b9086d160e7f09b7308023727`
and content hash
`221f1875b906cf29e6cb918cfdcedc004671e8671a030e48d9f10f4dc4120f26`;
its native outcomes contain one successful baseline, 358 unique mutants,
zero survivors, and zero timeouts.

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
| Notation3 | `b975fc59ab5d2ad2d28e7206f1c34c716977d2ad` | Optional Community Group draft profile |

JSON-LD API and Streaming evidence does not establish RDF 1.2 triple-term
parity. Notation3 is an optional Community Group draft profile, not a W3C
Recommendation-track RDF 1.2 surface. JSON-LD Framing is not pinned and is
explicitly unsupported/out of programme scope.

The reviewed Data Shapes suite-content SHA-256 is
`1d2c1c40769da1cf63fef62f3029447a66b5e81b5744b4cf2eaa5e128ba51a3a`.
The five specification hashes are recorded exactly in the
[standards registry](standards-registry.json) and checked by the programme
evidence verifier.

## Supporting-suite gaps

The exact supporting parser lane passes 5/5 wrappers, with explicit bounded
dispositions:

- N3 passes 208 parser, 871 extended, and 296 Turtle cases. Its two 87-entry
  reasoner manifests are unsupported because no reasoner handler/wrapper is
  registered.
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
   current after every protected-input change; neither can close a normative
   gap on its own.
5. Advance reviewed draft pins only through an explicit drift review.

## Canonical references

- [Standards and source registry](standards-registry.json)
- [Machine-readable conformance ledger](conformance-ledger.json)
- [Normative requirements inventory](normative-requirements.json)
- [Implementation and qualification plan](../plans/semantic-parity-metaharness-plan.md)
- [Current visual programme report](semantic-parity-programme.html)

The earlier Jena baseline and research syntheses remain historical inputs. They
must not be used as current evidence receipts.
