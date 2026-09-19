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

1. **A `curl -sL` hides a rename.** `w3.org/TR/shacl12-rules/` responds **301 →
   `w3.org/TR/sparql12-rl/`**, so `curl -sL` reports `200` and the redirect
   passes unnoticed. Corrected 2026-09-19: an earlier revision of this record
   claimed the old URL "serves a frozen snapshot of a deleted document." It does
   not — W3C handled the rename correctly, and the failure was mine for
   following a redirect silently and reporting the final status as if it were
   the original's. The editor's path `w3c.github.io/data-shapes/shacl12-rules/`
   **does** hard-404, and `gh api contents/shacl12-rules?ref=gh-pages` confirms
   the directory is gone. Check redirects explicitly (`curl -sI`, or
   `-w '%{url_effective} %{num_redirects}'`) before concluding what a URL
   serves.
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

2. **Implement `WHERE DATA` / `NOT DATA` execution.** Highest-value code change.
   A second review round (2026-09-19) derived the semantics from the spec's own
   `evalRule`/`evalRuleElements` pseudocode, which is worth recording because
   the surface prose is misleading:

   - `GD` = base graph ∪ all inline `DATA{}` blocks, **frozen for the whole
     evaluation** and never mutated by derivation. `GE` (the evaluation graph)
     starts at `GD` and accumulates derived triples stratum by stratum.
   - `WHERE DATA` pins *both* graph arguments to `GD`, which makes it **sticky**:
     every nested element of that rule — including a plain `NOT{}` carrying no
     `DATA` keyword — inherits `GD`-only matching. Upstream fixture
     `eval-dft-value-where-01.srl` exercises exactly this.
   - `NOT DATA` inside an ordinary rule overrides only that one negation to
     `GD`; the rest of the body still sees `GE`.
   - **The Component-Notation prose table contradicts the algorithm** on the
     direction of `rule.data`. The pseudocode is authoritative; the table is
     inverted. Do not implement from the table.

   Where the change goes: `native.rs`, not the Datalog lowering. Any rule
   containing a Filter, Assignment, or Negation flips `native::required()`
   (`native.rs:30-33, 218-230`), routing the entire rule set to the native
   path — so `compile_program`'s own `data_only` guards
   (`evaluate.rs:210-238, 268-276, 330-339`) are **unreachable dead code**
   today. Thread the already-in-scope frozen `base` alongside `working` through
   `evaluate_elements`/`match_pattern`, selecting per
   `rule.data_only`/`negation.data_only`. Extend `required()` to also return
   true for those flags so the Datalog path is never selected for them.
   `check.rs` needs **no** change: the spec's own dependency-graph algorithm
   ignores `rule.data`/`negation.data`, and ours already does the same.

   The 19 fixtures in the new upstream `eval2/` directory are precisely this
   feature's suite (`eval-dft-value-where-*`, `eval-dft-value-neg-*`,
   `link-1/2-*`) and all 19 fail today, from either this rejection or the
   abbreviation gap in item 3.

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

6. **`shacl12-inference-rules` conformance — pass completed 2026-09-19.** The
   SPARQL rule surface fares well: `sh:order`, `sh:condition` (including the
   spec-required rejection of conditions on global rules), and `sh:deactivated`
   all match, at `sparql_rules.rs:352-370, 213-220, 88-93, 222-234` and
   `execution.rs:73-119, 227-244, 159-161`. Outstanding, in priority order:

   - **`sh:ruleProcessor` fail-closed** — the one MUST-level clause we actively
     violate. An unrecognized processor value must force failure; we ignore it
     silently. Small, correctness-relevant.
   - **`sh:layer`** on the SPARQL surface — a real, stable-clause gap. Our
     fixpoint is flat rather than per-layer, which is the same root cause as
     the `sh:runOnce` absence, not a separate defect.
   - **Reword ADR-0008's Datalog claim.** The gap there is not "missing
     order/condition/deactivated/layer" — `rules.rs` has no RDF compiler for
     `sh:TripleRule` at all; it is a programmatic Rust API never fed from RDF.
     "Supported triple rules compiled to Datalog" currently reads as if the RDF
     syntax is supported. Clarify the wording rather than logging a code gap.
   - Do not chase: `sh:runOnce` (already covered by ADR-0008's issue-1069
     exclusion), `sh:SPARQLRuleTemplate` (one day old),
     `sh:expectedPredicate`/`sh:sourceRule`/`sh:tempTriple` (all MAY-level).

   Caveat carried honestly: the reviewer checked for at-risk markers by prose
   extraction and did not diff raw HTML for `class="issue"` spans, so "no
   at-risk items" is provisional for that document, not confirmed.

7. **Smaller SPARQL-RL gaps** surfaced by the full grammar walk, recorded so
   they are not rediscovered: `TripleTermData` as a `DATA`-block subject is
   rejected (`data.rs:67-71`) though grammar `[42]` permits it; `BNODE()` is
   unsupported (`expression.rs:191-194`). Also note `reject_query_goal`'s
   position-by-position restrictions (`policy.rs:25-65`) are **our own
   invention** — the spec leaves goal syntax entirely undefined — which is
   defensible as RDF well-formedness but should not be described as
   spec-mandated.

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
