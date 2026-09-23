# ADR-0046: SHACL 1.2 editor's-draft realignment

- **Status**: Accepted
- **Date**: 2026-09-19
- **Updated**: 2026-09-22 — candidate clause evidence contracts delivered
  (`899a2d0c`, `8d71c036`); first candidate suite execution recorded. Four of
  its nine selected-case failures fixed in `9b79e301` and `6b4dad55` (GD-only
  matching must not create stratification dependencies), taking the suite from
  551 to 555 of 560; five remain, three needing graph-capable custom-function
  registration and two blocked on the recorded GD/G0 ambiguity.
- **Updated**: 2026-09-23 — the GD/G0 ambiguity is decided provisionally by
  [ADR-0047](0047-srl-inline-data-excluded-from-frozen-data-graph.md) and
  reported upstream as
  [w3c/data-shapes#1276](https://github.com/w3c/data-shapes/issues/1276).
  Inline `DATA` blocks are no longer part of the frozen data graph
  (`fede6934`); the suite runs 557 of 560 (`run-5zBsV0`).
- **Updated**: 2026-09-23 — the three custom-function cases pass: declared
  `sh:ListParameterExpressionFunction`s are registered with SPARQL
  (`0e909e38`). The candidate suite now passes **560 of 560** selected cases
  with no failures (`run-E3L2Ng`). Independent review rejected `0e909e38` on
  five resource-safety and specification points, fixed in `7931a493`, which
  still passes 560 of 560 (`run-6RNt9N`).
- Deciders: Oxigraph parity programme
- Implementation status: DATA execution and fail-closed `sh:ruleProcessor`
  handling (A+C) delivered in `e9a285c8` on 2026-09-20. Body abbreviations and
  inference-rule layers/ordering (B+D) delivered in `6e933eea` the same day.
  Core value union/default semantics delivered in `6c317a9a`; expected-predicate
  layer lifecycle and scalar-expression absence handling delivered in `85580fc9`.
  Candidate clause evidence contracts delivered in `899a2d0c` with their
  verifier-side checkout test in `8d71c036`; their independent review returned
  INCONCLUSIVE with one blocker still open, recorded below. The candidate suite
  has now run for the first time: clause audit and Jena compact pass, the suite
  command fails at 551 of 560 expected passes on nine unimplemented engine
  features. The reviewed suite evidence transition and smaller language gaps
  therefore remain open. The
  plan below is ordinary buildable work under
  [ADR-0044](0044-post-deployment-production-tuning.md), not a gated backlog.
- **Related**:
  [ADR-0008 — SHACL processor profiles](0008-shacl-processor-profiles.md),
  [ADR-0044 — Post-deployment production tuning](0044-post-deployment-production-tuning.md),
  [ADR-0045 — Linux-only target platform](0045-linux-only-target-platform.md)

## Context

Our SHACL evidence is pinned to `w3c/data-shapes` commit `eedda09f`. A
four-reviewer swarm compared the live editor's drafts against `lib/oxshacl` on
2026-09-19. The pin is **177 commits behind** `gh-pages` as of that date
(`gh api compare`, verified directly; the review first reported 176, and the
figure rises as upstream moves — treat it as dated, not fixed), and in that
window the
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

3. **`FOR`/`IN` was a stale rejection of the opposite kind.** The construct was
   *removed* from the grammar on 2026-08-12, not left pending. The only `FOR`
   tokens remaining in the BNF are `ENCODE_FOR_URI` and `STRBEFORE`. Resolved
   2026-09-19: the parser no longer accepts a `for_clause`; removed syntax now
   fails as syntax instead of surviving to an execution-time unsupported error.

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

   The SRL corpus grew substantially, with two new subdirectories (`eval2/`,
   `wellformed/`). `core/` is untouched; `node-expr/` has one fixture edit.

   Counts corrected 2026-09-19 by direct `gh api` listing. This read "grew from
   166 fixtures to 290"; 290 was 288 files plus 2 manifests, not a test count.
   The September 19 listing of `shacl12-test-suite/tests/sparql-rl/` held
   **198 `.srl` files** across 288 files: `eval` 30, `eval2` 6, `examples` 5,
   `stratification` 10, `syntax` 139, `wellformed` 8. The re-pin in item 5 must
   recount against `.srl` cases and the manifest, never a file listing — this
   same file-vs-case conflation appeared three times in the round-one review. Our root-validate lane is insulated from upstream's new root-manifest
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
     evaluation** and never mutated by derivation. (Superseded by ADR-0047:
     the frozen data graph is the base graph only.) `GE` (the evaluation graph)
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

   The new upstream `eval2/` directory is precisely this feature's suite:
   **6 test cases** — `eval-dft-value-where-01/02`, `eval-dft-value-neg-01/02`,
   `link-1-path`, `link-2-path` — each with its own `-data.ttl` and
   `-results.ttl`, so 19 files plus `manifest.ttl`. All 6 fail today, from
   either this rejection or the abbreviation gap in item 3.

   Count corrected 2026-09-19: this said "19 fixtures … all 19 fail", which
   counted files rather than test cases. Verified by direct `gh api` listing of
   `shacl12-test-suite/tests/sparql-rl/eval2`. The set of cases was right; only
   the number was wrong.

3. **Accept body abbreviations** — collections, blank-node property lists,
   reifiers and annotation blocks in rule bodies, mirroring the existing
   `expanded_head` auxiliary-triple approach rather than blanket-rejecting in
   `reject_pattern_node`.

4. ~~**Decide `FOR`/`IN` parsing.**~~ **Done.** Removed syntax is rejected by
   the parser. No compatibility extension is retained for a construct absent
   from the governing grammar.

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
   they are not rediscovered: inline `DATA` triple-term lowering is unsupported,
   including object position (`src/srl/evaluate/data.rs::ground_term`). B+D's
   first fixture run established this broader boundary; the earlier note
   mentioned only the separate triple-term subject restriction. Grammar
   production `[42]` permits `TripleTermData`; the required RDF subject model
   must be checked separately. `BNODE()` is also unsupported
   (`src/srl/evaluate/expression.rs:191-194`).
   Path corrected 2026-09-19: both were first recorded as bare `data.rs` /
   `expression.rs`, which do not exist at that level — and
   `lib/oxshacl/src/expression.rs` does exist while being a different file.
   Also note `reject_query_goal`'s
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

### A+C ordinary delivery, 2026-09-20

Commit `e9a285c8` implements frozen base-plus-inline GD, accumulating GE,
sticky `WHERE DATA` and local `NOT DATA`. The extra frozen copy is allocated
only for DATA-bearing rule sets and charged before cloning. The SPARQL-rule
compiler rejects explicit processor declarations on rules and rule sets;
no custom processor identity is advertised, and absence retains the default.

Engineering workflow `a0bf1946-47fb-43ab-b212-6bba1a90ac67` completed with
independent review and exact MCP evidence readback under
`programme-task-evidence/workflow-a0bf1946-47fb-43ab-b212-6bba1a90ac67`.
Its local records are in `target/engineering-delivery/workflow-mum0th/`.
The focused DATA and processor checks passed 8 and 2 tests; the full oxshacl
all-features and no-default-features lanes passed 186 and 124 tests.

The first focused run exposed an invalid test containing NOT inside NOT.
Grammar productions [21]-[23] admit only triples and FILTER inside a NOT body;
the parser was correct. The reviewed replacement tests the valid combination
of WHERE DATA and NOT DATA with both a GE-only blocker and a GD blocker.
The failed attempt remains in the workflow history. These are ordinary native
test results; no suite pin, protected expected result or qualification changed.

### B+D ordinary delivery, 2026-09-20

Commit `6e933eea` implements the following contract through workflow
`29ec2875-a6f3-42be-bcf7-7004b77ea68d`, with exact MCP evidence at
`programme-task-evidence/workflow-29ec2875-a6f3-42be-bcf7-7004b77ea68d`.
The original nine-path proposal exposed a parser gap: standalone collections
and reified patterns were discarded. The replacement ten-path workflow
explicitly admitted `src/srl/parser/nodes.rs` before application.

Shared expansion now serves body matching and dependency analysis, including
rule-wide existential blank labels and auxiliary triples. Reified syntax does
not assert its referenced triple; annotations do assert their containing triple.
RDF 1.2 capability checks run before matching, including empty negation and
short-circuited bodies. Numeric layers close in ascending order, and all rules
of equal order within a layer share a snapshot regardless of attachment scope.
Inactive-only layers consume no iterations; resource limits remain cumulative.

Focused abbreviation, clause-inventory and layer checks passed 8, 9 and 11
tests; full all-features and no-default-features checks passed 205 and 133.
A fresh Sol/medium reviewer accepted the exact candidate with no findings.
The workflow retains the failed inline-DATA fixture setup, test-helper lifetime
errors and incorrect diagnostic spelling. Repairs preserved the body oracle's
five base triples and eight assertions, using an external graph for the existing
DATA limitation. No pinned inventory, expected graph or qualification changed.

### Delivered B+D contract

Body abbreviation expansion must serve both matching and dependency analysis,
including auxiliary predicates and blank-label scope. For SHACL-SPARQL,
implement layers and uniform rule ordering together: each equal
`(layer, rule order)` group shares one input snapshot across global and
shape-attached rules, then merges its inferred union. A global-first or
shape-order-first partition would preserve a mismatch with the current
inference-rules ordering clause. Complete lower layers before advancing,
with cumulative resource limits; preserve the separate repeated-firing
exclusion. The suite repin follows corrected behavior and explicit review of
the exact old/new evidence packet.

### E1 runner transport and cleanup, 2026-09-20

Commit `c40b57f2` delivers manifest-driven inference discovery, bounded local
external data/shapes/result graphs, strict graph comparison, and explicit
historical/current SRL manifest and namespace support. Workflow
`df768642-e5ba-49b1-bad5-63bb7df68dfe` passed 9/12/9/12 local example tests
across all-features and no-default-features with w3c-tests. Independent
Sol/medium review accepted the exact source after mechanical warning repairs.
MCP evidence is `programme-task-evidence/workflow-df768642-e5ba-49b1-bad5-63bb7df68dfe`.

Commit `9f0cdfcc` separately clears the five-path SHACL implementation/test
Clippy backlog without changing behavior or assertions. Workflow
`14666add-0129-484b-97d6-61f5930de044` passed the DATA/body checks 8/8/8/9 and
both all-target Clippy configurations (all-features; no-default-features with
w3c-tests) with zero warnings in complete logs. Fresh independent Sol/medium
review accepted it; MCP stored and read back the exact workflow evidence.
The rejected attempt remains recorded: `.expect` introduced a new lint and
was replaced with the existing test `.unwrap` idiom. These checks did not run
the candidate upstream suite or change historical evidence.

### Core values and expected predicates delivered, 2026-09-20

Commit `6c317a9a` unions path and computed property values before lazily
evaluating a default for an empty combined set. Workflow
`a6ec0b01-3ed6-4623-9af8-a32a5a649666` passed 9 focused tests in each feature
configuration, 214/142 full-package tests and both Clippy configurations.

Commit `85580fc9` prepares expected-predicate values once at each layer's
start, propagates direct and nested property focus, and shares the operation's
resource controls. Temporary derived values expire after the layer; base data
and independently inferred overlap remain. RDF 1.2 cleanup preserves earlier
durable reifier metadata and rejects a reifier shared by expired and retained
triples rather than deleting retained associations. Preparation is one pass
over the layer-start snapshot, not a computed-property fixpoint.

The same slice lifts absent required strict scalar operands to empty output
while preserving absence-aware functional forms, unsupported-function errors,
all-bound evaluation errors and generic SELECT failure behavior. Its oracle
requires compilation to succeed before runtime-error assertions are evaluated.
Workflow `2cc39143-3b2a-4b5a-95ae-c1278bb91cd9` passed all nine commands:
node-expression checks 14/14, expected-predicate checks 16/11, full-package
checks 236/217/142 and two all-target Clippy checks, with zero warnings in
complete logs. Independent Sol/high review accepted the cumulative change from
`6c317a9a`; exact MCP evidence was stored and read back before commit under
`programme-task-evidence/workflow-2cc39143-3b2a-4b5a-95ae-c1278bb91cd9`.
Rejected attempts and their repairs remain in the local workflow history.

This supersedes the earlier plan's decision not to implement
`sh:expectedPredicate`. RDF `sh:runOnce`, `sh:tempTriple`, `sh:TripleRule`,
`sh:SPARQLRuleTemplate`, custom processors and optional `sh:sourceRule`
provenance remain separate boundaries. No upstream candidate suite ran and
no historical pin, profile, expected graph or qualification claim changed.

### Next: reviewed suite update and remaining language semantics

The narrow ordinary-harness admission task `task-1789864711141-06ypsp`
completed in `2b2de51b`. Workflow `4af7e5c5-1deb-4377-acc2-70678bf29044`
admits exact source paths and commands; 75 contract checks passed on Node 24
and, as supplemental evidence on the same candidate, Node 20. Independent
Sol/medium review accepted it. No suite command ran in this adapter slice.

Read-only research identified candidate upstream commit
`0ccfab4f28324edaac59a1227f8c60ad5b7bbf89` (178 commits after the historical
pin). The Astra/xhigh coordinator accepted this exact implementation candidate
after independently verifying suite hash
`fa1ff95904600c553036123fd6eef66ad281a934830673ee7e9402b3257a3376`.
It is not yet applied or tested. Existing dated profiles, historical receipts
and their validators retain the old pin; candidate evidence will use separate
revision/run paths. Its SPARQL-RL manifests list
**203 cases**, including 35 `eval` cases, while the tree has 198 `.srl` files.
Its inference-rules manifests list 21 cases. The runner update also needs the
new `sparql-rl-tests#` namespace and six included manifests, not just renamed
paths. Review the exact inventory, hashes, root reachability and exclusions;
preserve historical receipts and upstream expected results.

Subsequent Astra/xhigh source review identified two required semantic repairs,
now delivered by the commits above:
Core property values must union path and sh:values results before applying a
default to an empty set; sh:expectedPredicate needs derived-value preparation
and cleanup across rule layers. The selected expectedPredicate example remains
a selected, unexecuted obligation. The 569-declaration inventory is reaffirmed,
including 14 selected inference cases and seven predeclared unsupported cases;
the earlier description of all 14 as transport-only is withdrawn.

The pinned SRL algorithm defines GD from base plus inline DATA but calls
evalRule with G0. Preserve the accepted A+C implementation and record this
source ambiguity as a limit on literal algorithm-equivalence claims. Do not
silently rebaseline DATA semantics or change fixtures to resolve it.
ADR-0047 (2026-09-23) is the explicit decision this paragraph required: it
adopts the `G0` reading, and fixtures stay unchanged.

The remaining sequence is candidate evidence tooling, complete ground DATA
materialization and BNODE evaluation, candidate clause mappings, then ordinary
suite execution against the final clean implementation. DATA and BNODE need
independent semantic oracles: the candidate's inline triple-term DATA coverage
is syntax-only and it has no BNODE `.srl` fixture. The exact bounded language
decision is
`target/engineering-delivery/adr0046-repin-research/coordinator-language-residuals.md`,
SHA-256 `b1a822fd1fad599ca2ac0e0de2bad543ae39f497c329d66e114d00e4f68f3a98`.
Independent
tooling preparation may overlap semantic work; root applies and verifies one
source-stable workflow at a time. The exact local coordination decision is
`target/engineering-delivery/adr0046-repin-research/coordinator-e-semantic-sequence.md`,
SHA-256 `b5968effd6c3d968514e0f77e3f1b29394692aef2af962c08b7b4f055461f59f`.
Historical pins, profiles, expected graphs and receipt validators remain intact.

### Candidate clause mappings delivered; first candidate suite execution

Candidate clause evidence contracts (E3) were delivered in `899a2d0c`, with the
verifier-side checkout test that its oracle depends on added in `8d71c036`.
Five defects found by the first actual validation of the applied candidate were
repaired in candidate logic and its emulation: a grammar extractor that threw on
the W3C EBNF `@terminals` section directive, an independent second copy of that
extractor in the verifier, an oracle fixture that reused a deliberately-dirty
checkout helper while expecting a clean one, a verifier that read
`sourceStatus` from facets when that field belongs to the mapping, and a
byte-drift test that did not restore artifact mtime before verifying. No
fixture, exclusion, pin, digest or expected result was adjusted to turn a
failure green. Verified on Node 24.14.1 and Node 20.20.2, 39/39, receipts
`run-PH6dxc` and `run-Z1l0Pb`. Corrected 2026-09-23: those receipts ran at
`899a2d0c` with `tools/evidence/verify-programme.test.mjs` modified in the
working tree, the verifier-side test later committed as `8d71c036`. They are a
dirty tree, not "clean committed HEAD" as this record previously said.

Independent Fable/high review returned **INCONCLUSIVE**, not acceptance. It
confirmed no pin was weakened, that the verifier still recomputes independently,
and that drift detection is intact. One blocker it raised is closed: receipts are
now bound to a clean committed HEAD. One remains open and is recorded here
rather than resolved by weakening anything: the verifier's `git status` check
cannot see `skip-worktree` index entries, and the E3 oracle relies on exactly
that. Hardening the verifier to reject hidden entries was implemented and
reverted, because the embedded corpus carries 704 of the pinned tree's 1127
entries and supplies no blob for the other 423, so the fixture cannot present a
complete clean checkout. Closing it needs either the full tree embedded or an
explicit reviewed notion of a partial corpus.

The candidate suite then ran for the first time, against committed source
`899a2d0c`. Two of three commands pass: the clause audit (`run-AdTbwc`) reports
9 documents, 233 clause candidates, 219 syntax rules, 153 grammar productions and
38 obligation joins; the independent Jena compact comparison (`run-VSBRJs`)
matches all 32 selected fixtures. The suite command itself fails (`run-VYL2oi`,
exit 1) with **551 passed against 560 expected**. Inventory conservation holds
exactly — 569 declared, 567 eligible, seven predeclared unsupported, two excluded
— so the shortfall is in observed passes, not bookkeeping.

The nine failures are unimplemented engine features, diagnosed against source in
`target/engineering-delivery/adr0046-e4/failure-diagnosis.json`:

- Three `validate` cases invoke a `sh:ListParameterExpressionFunction` from
  inside user `sh:select` text. oxshacl evaluates such functions only via
  `evaluate_node_function`, by textual substitution on the node-expression path;
  no `QueryEvaluator` it builds registers a custom function, so the call cannot
  resolve. `spareval` already offers `with_custom_function`, but its
  `Fn(&[Term]) -> Option<Term>` signature has no dataset access, while these
  function bodies must read the data graph.
- Six `srlRules` cases involve `NOT DATA` and `WHERE DATA`. The
  `SrlError::Unsupported` messages in the Datalog lowering are a red herring
  here: `native::required` routes any rule using the data graph to the native
  path, so those messages are unreachable for these fixtures. Four of the six
  failed in stratification and are now fixed (below); two remain, for a
  different reason.

Four of the nine are now fixed. Stratification treated a `NOT DATA` group, and
the whole body of a `WHERE DATA` rule, as ordinary dependencies. Both read the
frozen graph GD, which no rule head can write, so neither can depend on any
rule's output; a rule whose head predicate also appeared in its own negation
was therefore rejected as recursive before evaluation. `9b79e301` excludes
`data_only` negations from the dependency graph and `6b4dad55` excludes
`WHERE DATA` rules entirely. GD semantics are untouched by both. Measured on
the suite: 551 -> 553 -> 555 passes of 560 expected, with inventory
conservation unchanged throughout (`run-VYL2oi`, `run-3KlWyX`, `run-MnV8VH`).

Five failures remain. Three are the custom-function cases above, whose observed
error is now confirmed verbatim as "The function <...> is not supported".
Closing those needs a graph-capable custom-function registration in `spareval`,
whose `with_custom_function` currently takes a pure `Fn(&[Term]) -> Option<Term>`
while two of the three function bodies must read the data graph; that is a
cross-crate interface change and its own slice.
That turned out not to need a spareval change. `0e909e38` compiles each
declared list-parameter function once with the shapes graph and registers a
closure on every SHACL-SPARQL evaluator. The closure evaluates the compiled
body through the existing node-expression path, with a real validation
context and a per-call budget built from the caller's options. That budget
uses the same cancellation token, the caller's remaining deadline and the
same ceilings. Usage is charged back to the outer budget after the query. A
limit, cancellation or ill-formedness error inside a call is re-raised rather
than becoming an unbound value, because spareval's registry can only return
"no value". Two supporting changes were needed. `shnex:instancesOf` now takes
a node expression, as `InstanceOfExpression-evaluation` specifies; the public
`NodeExpression::InstancesOf` variant changes from `NamedNode` to
`Box<NodeExpression>`. And a select expression that aggregates pre-binds
`this` by substitution instead of projecting it. Independent tests are in
`lib/oxshacl/tests/sparql_declared_functions.rs`.

Independent review of `0e909e38` returned REJECT with five blocking findings,
all fixed in `7931a493`:

- Each call built a fresh budget, so K calls could spend K full ceilings. Each
  call's budget now covers only what the caller and earlier calls have left.
- Compiling the declarations restarted the caller's timeout. It now uses the
  caller's budget.
- A body with no output node counted as success. Any count other than one now
  yields no value, which is spareval's only expression-error signal.
- The unbound-argument and arity handling could never run, because spareval
  stops at an unbound argument before calling the function. Arguments now map
  by position and the limitation is documented: an unbound argument to an
  optional parameter is an error, stricter than the specification.
- A declaration could replace a built-in `xsd:` cast. `xsd:` declarations are
  no longer exposed, and an already registered name is left in place.

Declared functions are registered only for `sh:sparql` constraint and custom
component queries. They are not available in node-expression `sh:select`,
`sh:sparqlExpr`, SRL or SHACL-SPARQL rules. The specification says SHOULD, so
this is a known gap rather than a violation.

| Command | Receipt | Head | Outcome |
| --- | --- | --- | --- |
| `cargo test --locked -p oxshacl` | `run-zlOwZO` | `7931a493` | 246 passed, 0 failed |
| `cargo test --locked -p oxshacl --all-features` | `run-CqeTry` | `7931a493` | 283 passed, 0 failed |
| `cargo clippy` default / all / no default features | `run-n17eyy`, `run-fVHh13`, `run-eK9cf4` | `7931a493` | passed; the only warnings are two `srl/evaluate/native.rs` diagnostics, present before this change, in the no-default build |
| `node tools/shacl-tests/run.mjs` | `run-6RNt9N` | `7931a493` | 560 of 560 selected, 7 predeclared unsupported, 2 excluded, 0 failed |

The other two, `eval-neg-data-03` and `eval-neg-data-06`, fail because GD
includes inline `DATA{}` blocks, so a `NOT DATA` over an inline-asserted pattern
does not hold. Upstream `eval-where-data-03` and the `eval-neg-data-06` comment
("the DATA block is inferred") read as though GD should exclude those blocks.
This is exactly the GD/G0 ambiguity this ADR already records. The change was
implemented, made both cases pass, and was **reverted**: it contradicted this
ADR's instruction to preserve the accepted A+C implementation rather than
silently rebaseline DATA semantics, and it broke two existing tests that encode
the current reading. Resolving it needs an upstream answer, not a local choice.
On 2026-09-23 the owner chose reading B explicitly. ADR-0047 records the
decision and the upstream issue (w3c/data-shapes#1276). `fede6934` applies it
and updates the three tests; both cases now pass (`run-5zBsV0`, 557 of 560).

With both clusters closed, the candidate suite passes 560 of 560 selected
cases at `0e909e38` (`run-E3L2Ng`) and again at `7931a493` (`run-6RNt9N`), with 569 discovered, 567 eligible, 7
predeclared unsupported and 2 excluded; the receipt reports `complete: true`
and no errors. The command exits 2, not 0, because `tools/shacl-tests/run.mjs`
returns 2 whenever predeclared unsupported cases exist; that is its designed
signal, not a failure. This is ordinary suite execution only: it grants no
conformance, qualification, promotion or publication claim, and the reviewed
suite evidence transition is still separate work.

The historical note that follows described the state before the fixes above.
The remainder are pre-existing gaps in the Rust engine, unrelated to the
evidence tooling above. They are ordinary buildable work under ADR-0044, each its own
slice. They have **not** been moved into the predeclared-unsupported or excluded
sets: those are fixed by the readiness file, and a selected failure is a failure.
Ordinary suite execution remains incomplete until they are implemented, and no
qualification, promotion, conformance or publication claim follows from the two
passing commands.

### Original investigation

Swarm findings are recorded in the `programme-reviews` memory namespace under
`shacl12-editors-draft-core-nodeexpr-verified-2026-09-19`,
`shacl12-rules-doc-replaced-by-inference-rules-2026-09-19`,
`shacl12-suite-pin-drift-176-commits-2026-09-19`, and
`shacl12-inference-rules-layer-model-correction-2026-09-19`. Every claim above
was re-verified directly against the authoritative source — commit diffs via
`gh api`, and `sparql-rl-grammar.bnf` fetched from the live editor's draft —
rather than accepted from a reviewer's summary or a rendered page.
