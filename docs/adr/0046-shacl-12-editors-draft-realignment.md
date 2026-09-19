# ADR-0046: SHACL 1.2 editor's-draft realignment

- **Status**: Accepted
- **Date**: 2026-09-19
- Deciders: Oxigraph parity programme
- Implementation status: findings recorded; no code changed by this record. The
  plan below is ordinary buildable work under
  [ADR-0044](0044-post-deployment-production-tuning.md), not a gated backlog.
- **Related**:
  [ADR-0008 — SHACL processor profiles](0008-shacl-processor-profiles.md),
  [ADR-0044 — Post-deployment production tuning](0044-post-deployment-production-tuning.md),
  [ADR-0045 — Linux-only target platform](0045-linux-only-target-platform.md)

## Context

Our SHACL evidence is pinned to `w3c/data-shapes` commit `eedda09f`. A
four-reviewer swarm compared the live editor's drafts against `lib/oxshacl` on
2026-09-19. The pin is **176 commits behind** `gh-pages`, and in that window the
Working Group reorganized the rules specifications twice. Several of our
exclusions and error messages now describe a world that no longer exists.

Three traps made this hard to see, and all three caught this session's own
earlier analysis before the swarm corrected it. They are recorded because each
would recur:

1. **A deleted spec still serves HTTP 200.** `w3.org/TR/shacl12-rules/` returns
   a frozen snapshot of a document whose source directory was deleted upstream
   (`gh api contents/shacl12-rules?ref=gh-pages` → 404). Reading the TR yields a
   dead spec with no warning.
2. **Keyword-scanning a rendering misleads in both directions.** On the dead TR,
   `stratum` appearing 57 times wrongly implied our model matched. On a live
   draft, `fixpoint` appearing zero times wrongly implied the model had been
   dropped — the draft says *"executed multiple times until no further triples
   are inferred"* without ever using the word. Read the prose, or better, diff
   the source.
3. **A false cognate across two specifications.** `shacl12-inference-rules`
   introduces `sh:layer` and `sh:runOnce`; SPARQL-RL has stratification layers
   and run-once rules. These look like the same concepts renamed. They are not:
   they are unrelated properties in two different documents, and mistaking one
   for the other sends a review at the wrong target. This session made exactly
   that mistake and briefed a reviewer with the wrong URL; the reviewer caught
   it from commit history rather than accepting the premise.

## Decision

Realign our documentation and implementation to the live editor's drafts, and
record which document actually governs each of our three rule surfaces.

### Document identity, verified at commit level

| Our surface | Governing document today | Evidence |
|---|---|---|
| `lib/oxshacl/src/srl.rs` (SRL: `RULE{}WHERE{}`, `FILTER`, `SET`, `NOT`, stratification) | **`sparql12-rl`** — the SPARQL-RL specification | Commit `df4ee468`, 2026-08-19, "Move shacl12-rules/ to sparql12-rl/"; `shacl12-rules/index.html` → `sparql12-rl/index.html` as a tracked rename |
| `lib/oxshacl/src/rules.rs` (Datalog triple rules) | `shacl12-inference-rules` § Triple Rules | Commit `4199e812` (#1113), 2026-08-28, created the document |
| `lib/oxshacl/src/sparql_rules.rs` (`sh:SPARQLRule`) | `shacl12-inference-rules` § SHACL SPARQL Rules | Same |

SPARQL-RL is now decoupled from SHACL branding entirely: its own `.srl`
extension and `application/sparql-rl` media type. `shacl12-inference-rules` is
a **new** document (`index.html` added at +1720/−0), not a rename of the old
one; all 11 files of `shacl12-rules/` were removed, including the entire
`rules-rdf-syntax/` tree that ADR-0008's "RDF Rules Syntax mapping remains
placeholder text" exclusion was written against. That exclusion now cites
deleted material.

### What matches, and stays

Verified against `sparql12-rl`'s own `sparql-rl-grammar.bnf` and prose:

- **Stratification terminology is not stale.** SPARQL-RL still says "stratum",
  "strata", "stratification layer". Our `SrlStratum`/`SrlStratification`
  (`srl.rs:337-350`) are correct. The `sh:layer` naming belongs to the *other*
  document and does not apply here.
- **Run-once derivation matches verbatim**: "Rules involving assignments and
  rules that create blank nodes in their rule head are run-once rules" —
  `is_run_once()`, `check.rs:287-292`.
- **Stratification Condition matches**: no recursive dependency through a closed
  dependency — `closed = negative || run_once`, `check.rs:95-142`.
- **Bounded fixpoint iteration remains the model** in both documents.
- **Core and Node Expressions require no changes.** A source diff of both
  documents since our pin (`+126/−20` and `+37/−14`) shows no new or renamed
  constraint component. New vocabulary — `sh:ProcessorConfiguration`,
  `sh:usedDataGraph`, `sh:usedShapesGraph`, `sh:usedConfiguration`,
  `sh:conformsToShapesGraph` — is entirely **MAY**-level report provenance. The
  only added **MUST** is that processors *must not* alter validation behavior
  based on a `sh:ProcessorConfiguration`, which we satisfy by never consuming
  one.

### What diverges

1. **Body abbreviations are a real gap.** SPARQL-RL grammar productions
   `[69]`–`[79]` permit `CollectionPattern`, `BlankNodePropertyListPattern`,
   `AnnotationPattern`, `Reifier` and `ReifiedTriple` in rule **bodies**, via
   `ObjectPattern ::= GraphNodePattern AnnotationPattern`. Our
   `reject_pattern_node` (`policy.rs:102-128`) refuses all of them. We reject
   currently-specified syntax.

2. **`WHERE DATA` / `NOT DATA` is a stale rejection.** Production `[11]` reads
   `'RULE' iri? HeadTemplate 'WHERE' 'DATA'? BodyPattern`; `[21]` carries
   `'NOT' 'DATA'?`. Grammar landed 2026-07-07, evaluation semantics 2026-08-12,
   closing issue #960 — which our code still cites as open
   (`evaluate.rs:215-218`, `policy.rs:10-19`). The parser already carries a
   `data_only` field (`srl.rs:233,258`); only execution is missing.

3. **`FOR`/`IN` is a stale rejection of the opposite kind.** The construct was
   *removed* from the grammar on 2026-08-12, not left pending. The only `FOR`
   tokens remaining in the BNF are `ENCODE_FOR_URI` and `STRBEFORE`. Our parser
   still accepts a `for_clause` (`srl.rs:256`) and rejects it at execution
   citing "#1074" as draft-open (`evaluate.rs:210-213`, `policy.rs:5-9`). The
   outcome is right; the reason is wrong, and we accept syntax the grammar no
   longer defines.

4. **`shacl12-inference-rules` surfaces we do not implement**: `sh:layer`,
   `sh:runOnce`, `sh:expectedPredicate`, `sh:sourceRule`, and
   `sh:SPARQLRuleTemplate` (the last merged 2026-09-18, one day before this
   review). `rules.rs`'s `ShapeRule` (`rules.rs:42-53`) carries only
   `id`/`head`/`positive_body`/`negative_body` — a whole-file search returns
   **zero** occurrences of order, condition, deactivated, or layer.

5. **Test-suite lane roots are broken by the reorganization**, and will fail
   with `ENOENT` on re-pin — loudly, as designed:
   - `tools/shacl-tests/run.mjs:59` — `sparql/rules` → now `inference-rules/`
   - `tools/shacl-tests/run.mjs:72` — `rules` → now `sparql-rl/`
   - `lib/oxshacl/examples/w3c_srl_rules_runner.rs:39` — hardcodes
     `manifest-rules.ttl`, renamed to `manifest-sparql-rl.ttl` (directory *and*
     filename)

   The SRL corpus grew from 166 fixtures to 290, with two new subdirectories
   (`eval2/`, `wellformed/`). `core/` is untouched; `node-expr/` has one fixture
   edit. Our root-validate lane is insulated from upstream's new root-manifest
   `mf:include` because `w3c_runner.rs:40` scans an explicit allowlist
   (`["core", "node-expr", "sparql"]`) rather than chasing includes.

### What we will not chase

- **`TUPLE(...)` / rule tuples** — explicitly marked *"At risk"* in SPARQL-RL.
- **`$this` pre-binding** — marked at-risk in `shacl12-sparql` (issue #647). We
  implement it (`execution.rs:255-263`) and it is correct today, but it is
  at-risk-dependent, not settled.
- **`sh:SPARQLRuleTemplate`** — one day old, a single PR, no test-suite
  pressure yet. Revisit when the suite exercises it.

## Plan

Ordered by value, smallest defensible slices first. Each is independently
landable and independently reviewable.

1. **Correct the stale citations and error messages.** `FOR`/`IN` stops citing
   #1074 as draft-open (it was removed); `WHERE DATA`/`NOT DATA` stops citing
   #960 as draft-open (it was resolved). Update ADR-0008's Rules paragraph,
   which cites the deleted `rules-rdf-syntax/` material and the wrong governing
   document. Documentation only, no behavior change.

2. **Implement `WHERE DATA` / `NOT DATA` execution** — base-graph-only pattern
   matching. The `data_only` field already exists structurally; `evaluate.rs`
   and `policy.rs` need real semantics in place of `Unsupported`. This closes a
   stable, resolved-since-August gap and is the highest-value code change.

3. **Accept body abbreviations** — collections, blank-node property lists,
   reifiers and annotation blocks in rule bodies, mirroring the existing
   `expanded_head` auxiliary-triple approach rather than blanket-rejecting in
   `reject_pattern_node`.

4. **Decide `FOR`/`IN` parsing.** Either stop accepting syntax the grammar no
   longer defines, or keep it for back-compatibility with an honest message.
   Prefer removal; record whichever is chosen.

5. **Re-pin the test suite.** Not data-only: it needs the three path fixes in
   (5) above, a recount of the `sparqlRulesInfer` and `srlRules` lanes, a
   re-verification of ADR-0008's root-reachability claim, and fresh
   `suiteContentSha256`/`specificationSha256` values. Do this *after* 1–4 so
   the new corpus measures corrected behavior.

6. **Separately review `rules.rs` and `sparql_rules.rs` against
   `shacl12-inference-rules`.** This review targeted SPARQL-RL once the
   document identity was corrected; the inference-rules conformance of our
   other two rule surfaces has not had an equivalent pass. Decide explicitly
   whether the Datalog surface's missing rule metamodel (order, condition,
   deactivated, layer) is an intended scope line — and if so, say so in
   ADR-0008 instead of leaving it implicit.

## Consequences

- Our SRL implementation is closer to its specification than this session first
  believed: stratification, run-once derivation, the stratification condition,
  and fixpoint iteration all match the live SPARQL-RL draft.
- Two of our three "draft-open" rejections are stale in opposite directions —
  one resolved, one deleted — and both mislead anyone reading the error.
- Re-pinning is unblocked but not free, and is deliberately sequenced last.
- Future upstream-alignment reviews must establish **document identity first**.
  A review aimed at the wrong specification produces confident, verifiable,
  wrong conclusions.

## Alternatives rejected

- **Re-pin first, then fix.** The new corpus would measure known-stale
  behavior, producing failures that say nothing we do not already know.
- **Chase `sh:SPARQLRuleTemplate` because it is newest.** One day old, one PR,
  no suite pressure. Novelty is not priority.
- **Treat the `sh:layer`/`sh:runOnce` resemblance as a rename of our strata.**
  This was the session's own error before commit history corrected it. They are
  unrelated properties in a different document.

## Evidence and task ownership

Swarm findings are recorded in the `programme-reviews` memory namespace under
`shacl12-editors-draft-core-nodeexpr-verified-2026-09-19`,
`shacl12-rules-doc-replaced-by-inference-rules-2026-09-19`,
`shacl12-suite-pin-drift-176-commits-2026-09-19`, and
`shacl12-inference-rules-layer-model-correction-2026-09-19`. Every claim above
was re-verified directly against the authoritative source — commit diffs via
`gh api`, and `sparql-rl-grammar.bnf` fetched from the live editor's draft —
rather than accepted from a reviewer's summary or a rendered page.
