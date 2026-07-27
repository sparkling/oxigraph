# SHACL 1.2 evidence lane

`inventory.mjs` checks out the W3C Data Shapes repository at
`eedda09f93c39be1d2e978f3f942631494ae25a0`, verifies hashes for the five
editor drafts, the complete `shacl12-test-suite/tests` tree, and the SHACL-C
grammar and source/TTL pairs. It writes an inventory to
`target/w3c/shacl-1.2/inventory.json`.

`run.mjs` invokes five crate runners against that checkout: full validation
report comparison, node-expression evaluation, the six RDF SHACL-SPARQL
`sht:Infer` cases, the standalone SRL Rules manifest, and the 32 SHACL-C
source/expected-graph pairs. It writes a consolidated
`target/w3c/shacl-1.2/run-receipt.json` and the case-level
`target/w3c/shacl-1.2/run-cases.json`. Each pinned lane has exact count and
count-conservation gates. Passed, failed, unsupported, and excluded cases are
counted separately.

The current consolidated receipt discovers 521 cases and passes all 519
eligible cases: 167 validation + 143 node-expression + 6 legacy `Infer` + 171
supplemental SRL Rules + 32 informative SHACL-C cases. The two remaining
discovered cases are hash-pinned invalid upstream validation exclusions.
Separately, the native crate passes 167 tests with all features and 114 with
default features disabled.

```sh
node tools/shacl-tests/run.mjs
```

`jena-compact.mjs` independently runs Apache Jena 6.1.0 against the same 32
pinned SHACL-C graph pairs and writes its fail-closed differential receipt to
`target/datalog-oracles/jena-shaclc/receipt.json`.

```sh
node tools/shacl-tests/jena-compact.mjs
```

The W3C suite itself cautions that passing tests is only partial evidence and
does not prove complete specification conformance. The receipts preserve that
qualification. The standalone SRL lane executes 138 syntax, 8
well-formedness, 9 stratification, and 16 strict result-graph cases. Its
manifest is not root-reachable and declares no `mf:approval`, so receipts
preserve `lane=supplemental`, `rootReachable=false`, and
`mfApproval=unspecified` instead of presenting it as approved root evidence.
The SHACL-C specification labels its 32 graph pairs useful but non-normative,
so the inventory and execution receipts identify that lane as supplemental
informative evidence. Upstream supplies no normative negative corpus; local
negative syntax, limit, parse/RDF/serialization round-trip tests cover bounded
failure and stability behavior. Jena and Oxigraph both pass all 32 positive
pairs.
