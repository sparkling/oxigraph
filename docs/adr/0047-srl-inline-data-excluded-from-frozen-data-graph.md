# ADR-0047: SRL inline DATA blocks are excluded from the frozen data graph

- **Status**: Accepted (provisional; revisit when upstream answers)
- **Date**: 2026-09-23
- **Reviewed**: 2026-09-23, independent Opus review ACCEPT at `ee02f946`.
  That review relied on default-feature receipts and did not catch the three
  `rdf-12` tests fixed later in `a660b3fd`.
  (`target/engineering-delivery/adr0047-review/review.json`)
- Deciders: Oxigraph parity programme, on the owner's instruction of
  2026-09-23 to adopt reading B and track the upstream question
- Upstream issue: [w3c/data-shapes#1276](https://github.com/w3c/data-shapes/issues/1276)
- Amends: [ADR-0046](0046-shacl-12-editors-draft-realignment.md), which
  recorded this ambiguity and forbade a silent local rebaseline
- Implementation: `fede6934`, with three `rdf-12` tests completed in
  `a660b3fd`

## Context

SHACL 1.2 Rules (SRL) lets a rule set assert triples inline with
`DATA { ... }` blocks. It also lets a rule match against the frozen input
data only, with `WHERE DATA { ... }` and `NOT DATA { ... }`. The question is
whether a triple asserted in an inline `DATA` block counts as data for those
two constructs.

The pinned specification answers both ways. In
`sparql12-rl/index.html` at gh-pages commit
`0ccfab4f28324edaac59a1227f8c60ad5b7bbf89`, section
`#eval-rule-set` (lines 2036-2065):

```
let GI = { t ∈ D | t ∉ G0 }      # DATA blocks are inferred triples
let GD = G0 ∪ D                  # but GD includes them
let GE = GD
...
let X = evalRule(R, GE, G0)      # and evalRule is passed G0, not GD
```

`evalRule(R, G, GD)` (`#eval-rule`, lines 1988-2005) and
`evalRuleElements` (line 1959) use the third argument for `WHERE DATA` and
`NOT DATA`. So the variable named `GD` is computed and never used.

- **Reading A.** Inline `DATA` triples belong to the frozen data graph.
  `NOT DATA { :s :p :o }` is false when `:s :p :o` appears in a `DATA` block.
- **Reading B.** Only the input base graph `G0` is data. Inline `DATA`
  triples are inferred output, invisible to `WHERE DATA` and `NOT DATA`,
  and visible to ordinary rule bodies like any other inferred triple.

Evidence for B:

- The pinned candidate tests `eval/eval-neg-data-03` and `eval-neg-data-06`
  (commented `## DATA block is "inferred"`) expect reading B and fail under
  reading A. `eval-where-data-03` is consistent with B but passes under both
  readings, so it does not discriminate.
- The algorithm's own calls pass `G0`, and `GI` classifies `DATA` triples as
  inferred.
- The closed issue #791 resolved that data block triples "are added to the
  inference graph as inferred triples".

Evidence for A:

- The `let GD = G0 ∪ D` line.
- The opening example of the closed issue #960, which introduced
  `WHERE DATA` / `NOT DATA`, says `NOT DATA` "would include the rule set
  level `DATA{ }`".

Open issue #1271 is related (distinguishing base from inferred triples) but
does not address this inconsistency. We filed #1276 as the `sparkling`
account on 2026-09-23 asking which reading is intended. The body is kept at
`target/engineering-delivery/adr0046-e4/upstream-issue-1276-body.md`.

Commit `e9a285c8` implemented reading A. ADR-0046 recorded the ambiguity and
forbade changing it without an explicit decision. Under reading A the
candidate suite ran 555 of 560, with `eval-neg-data-03` and
`eval-neg-data-06` failing.

## Decision

Adopt reading B until the Working Group answers #1276.

- The frozen data graph used by `WHERE DATA` and `NOT DATA` is the input base
  graph only.
- Inline `DATA` triples stay in the inference graph and remain visible to
  ordinary rule bodies, so ordinary joins over them are unchanged.
- The `WHERE DATA` stickiness and `NOT DATA` override rules recorded in
  ADR-0046 are unchanged; only the content of the frozen graph changes.

This is the explicit decision ADR-0046 required, not a silent rebaseline.
No pinned fixture, manifest, expected result or inventory was changed. The
three unit and integration tests that encoded reading A were updated in the
same commit:

- `lib/oxshacl/src/srl/tests.rs::data_graph_execution_constructs_are_accepted`
- `lib/oxshacl/tests/srl_data_semantics.rs::frozen_data_graph_is_the_base_graph_without_inline_blocks`
  (renamed from `frozen_data_graph_contains_base_and_every_inline_block`)
- `lib/oxshacl/tests/srl_query.rs::query_executes_where_data_rules`

Three more tests, gated on the `rdf-12` feature, also encoded reading A. The
default-feature run did not compile them, so they were missed until an
all-features run and updated in `a660b3fd`:
`data_terms_feed_ordinary_where_data_not_data_and_query_consumers`,
`inline_only_documents_execute_in_native_and_datalog_lanes` and
`recursive_native_head_admission_stops_before_a_later_invalid_nested_term`
in `lib/oxshacl/tests/srl_data_terms.rs`.

## Evidence

Each receipt records its source head and tracked-diff hash. All three ran on
clean committed source (empty tracked diff). `0df117ff` is a documentation-only
commit on top of `fede6934`, so its code is identical.

| Check | Receipt | Head | Result |
| --- | --- | --- | --- |
| `cargo test --locked -p oxshacl` | `run-RwaL22` | `0df117ff` | command passed, 243 passed, 0 failed |
| `node tools/shacl-tests/run.mjs` (candidate suite) | `run-5zBsV0` | `fede6934` | 557 of 560; both `eval-neg-data` cases now pass |
| `cargo clippy --locked -p oxshacl --all-targets --all-features` | `run-S8irbr` | `0df117ff` | command passed, no diagnostics |
| `cargo test --locked -p oxshacl --all-features` | `run-Gg1n83` | `a660b3fd` | command passed, 270 passed, 0 failed |

The default-feature test run does not cover the `rdf-12` tests. Between
`fede6934` and `a660b3fd` the all-features suite had three failing tests;
`run-Gg1n83` is the first all-features receipt after the change.

An earlier test receipt, `run-WNm30W`, ran on `f24f54e4` with the change still
uncommitted. It is superseded by `run-RwaL22` and is not evidence for
`fede6934`.

The candidate command still exits non-zero. Its only three failures are the
`sparql/functions/*` custom-function cases recorded in ADR-0046, which this
decision does not touch. Inventory conservation is unchanged: 569 discovered,
567 eligible, 7 unsupported, 2 excluded. The pinned checkout was clean after
the run.

## Consequences

- The literal-algorithm-equivalence limit in ADR-0046 now reads: we follow
  the algorithm's `evalRule(R, GE, G0)` calls and the tests, and ignore the
  unused `let GD = G0 ∪ D`.
- A rule set that relied on reading A (using an inline `DATA` block to feed
  `WHERE DATA`, or to block a `NOT DATA`) now behaves differently. Such rule
  sets must put those facts in the input data graph.
- This decision grants no conformance, qualification or publication claim.

## Revisit

When #1276 is answered:

- If the Working Group confirms reading B, drop "provisional" from the
  status and record the answer here.
- If it chooses reading A, the candidate tests will change upstream. Re-pin
  through the normal evidence-drift review, restore the frozen graph as
  base plus inline blocks, and supersede this ADR.
- Check #1276 whenever the SHACL 1.2 pin is refreshed.
