# Oxigraph programme handover - 2026-09-23

## Start here

This continues `docs/handover/2026-09-22-codex-to-claude-programme-handover.md`.
Read that first for authority, harness mechanics and the gate catalogue. This
document records what changed since, and supersedes it wherever they disagree.

The programme is **not complete**. This is a deliberate pause at a clean
boundary: every piece of work started in this session is committed, reviewed
and recorded. Nothing is half-applied.

### Verified state at pause

| Item | State |
| --- | --- |
| Checkout | `/home/claude/src/hm/oxigraph`, canonical `main` |
| HEAD | `dbd02b2c6e78c65099488985922847f71d3c5de3` |
| Working tree | clean |
| Relation to remote | 254 commits ahead of `origin/main` (`5d8de3e5`); **nothing pushed** |
| Session commits | 31, from `899a2d0c` to `dbd02b2c` (all after handover commit `1229e844`) |
| Running programme work | none (verified by process listing) |
| Pinned W3C candidate checkout | clean at `0ccfab4f` |
| Cron / loops | none; the 10-minute loop `5af88a73` was cancelled |
| Publication, G1.7, qualification, promotion | none authorized, none performed |

One unrelated process may be visible, `cargo check -p sf-serve`. It belongs to
another project's session. Do not kill it.

## 1. Model routing changed

**Owner instruction, 2026-09-23: Opus replaces Fable in the harness.** Committed
in `ddb7e9b9`. Every model-bearing role now routes to `cc/claude-opus-5`:

| Role | Model | Effort |
| --- | --- | --- |
| Implementation, difficult implementation | `cc/claude-opus-5` | `xhigh` |
| Documentation | `cc/claude-opus-5` | `low` |
| Independent review | `cc/claude-opus-5` | `high` |
| Decisions, coordination | `cc/claude-opus-5` | `max` |

`cc/claude-fable-5-1` is removed from the admitted route set in
`tools/engineering-harness/src/delivery.mjs`, and a test asserts that it is
rejected. AGENTS.md, ADR-0043 and the harness README were updated to match. The
earlier handover's Fable/Sol/Astra routing tables are obsolete for new work.
Historical Fable executions keep their recorded identities.

## 2. Work delivered this session

Every item below was verified on clean committed source through
`tools/engineering-harness/bin/oxigraph-delivery.mjs` and reviewed
independently on native Claude Opus. The receipts live under
`target/engineering-delivery/run-*/`.

### E3: candidate clause evidence contracts (ADR-0046)

- `899a2d0c` applies the handed-over candidate and repairs five defects found
  by its first real validation, which went from 30/38 to 38/38. The five: a
  grammar extractor that threw on the EBNF `@terminals` directive; a second
  copy of the same extractor in the verifier; an oracle fixture that reused a
  deliberately-dirty checkout helper; the verifier reading `sourceStatus` from
  the facet instead of the mapping; and a byte-drift test missing its mtime
  restore.
- `8d71c036` adds the verifier-side dirty and wrong-revision rejection test.
- Independent review returned INCONCLUSIVE, not ACCEPT. One blocker stays open
  and is recorded in ADR-0046: the verifier's `git status` check cannot see
  `skip-worktree` entries. Hardening it was tried and reverted, because the
  embedded oracle corpus carries 704 of the 1127 pinned-tree entries and no blob
  for the rest.

### E4: SHACL candidate suite run (ADR-0046)

First real execution at the candidate pin `0ccfab4f`. Inventory conservation
held exactly: 569 declared, 567 eligible, 7 unsupported, 2 excluded.

- The clause audit passes: 153 grammar productions, 233 clause candidates.
- The independent Jena compact comparison passes 32/32.
- The suite command went from **551 to 555 of 560**:
  - `9b79e301`: a `NOT DATA` group no longer creates a stratification
    dependency, because it reads the frozen GD, which no rule writes.
  - `6b4dad55`: the same for a whole `WHERE DATA` rule.
- **5 selected failures remain**, all real, none reclassified:
  - 3 `validate` cases (`sparql/functions/*`) **resolved after this handover
    was first written**: `0e909e38` registers declared list-parameter
    functions with SPARQL without a spareval change. The suite now passes
    560 of 560 (`run-E3L2Ng`). The earlier diagnosis follows.

    A SHACL-declared function called
    inside `sh:select` text is not resolvable. Architectural blocker:
    spareval's `CustomFunctionRegistry` is `Fn(&[Term]) -> Option<Term> + Send
    + Sync`, while the function bodies need `&mut Budget` and `&mut
    ExpressionContext` (`instances_of` is `&mut self`), and that context is
    already mutably borrowed during constraint evaluation. This needs a
    cross-crate interface change. See
    `target/engineering-delivery/adr0046-e4/custom-function-analysis.json`.
  - 2 `srlRules` cases (`eval-neg-data-03`, `eval-neg-data-06`) **resolved
    after this handover was first written.** On 2026-09-23 the owner chose
    reading B: inline `DATA{}` blocks are inferred, not part of the frozen
    data graph. Reported upstream as
    [w3c/data-shapes#1276](https://github.com/w3c/data-shapes/issues/1276),
    decided in ADR-0047, applied in `fede6934`; the suite now runs 557 of 560
    (`run-5zBsV0`).

### G4.2: workload cancellation latency (ADR-0027)

- `4617d33e` adds the `oxigraph_admission_cancellation_latency_seconds`
  histogram: six admission families, exactly 100 samples.
- `1f6774d1` scopes two deliberate test panics with reasoned `#[expect]`, which
  brings the Clippy delta against the recorded baselines to zero.
- Independent review ACCEPTed at `73883f24` (session `6f97b635`), after eight
  rejections of the written record, each fixed.

### G4.2 follow-on: OxHTTP streaming-reset cancellation (ADR-0027)

Running the demo drill exposed a real bug. On a streaming response, the
response writer consumed `SO_ERROR` before the polling monitor saw it, so
`RequestTransportCancellation` never fired.

- `5783f5e7` reports writer-side transport failures to the same callback, at
  most once and never after the deadline.
- `f171a100` narrows that to OS socket errors only. A short response body
  synthesizes `ConnectionAborted` itself.
- Negative control, receipted in place: `run-kHOxe4`, `run-4icBGb`,
  `run-mYVdsq`, `run-wM2JRz`, `run-K7KBrj`, each failing with callback count 0.
- The streaming-reset test is **un-ignored**: 10/10 at `f171a100`, up from 4/10.
  The six-case 1/4/16 demo drill passes (`run-yaQQmB`).
- Independent review ACCEPTed at `0ae194fb` (session `454f0d66`).

### G3.5 first slice: HTTP SERVICE execution observations (ADR-0025)

- `75b3cc80` adds opt-in `HttpServiceObservation` built from the prepared
  five-path contract, with an independent implementation and oracle. It reports
  attempts, dispatches, decoded bytes, rows and completed / failed / abandoned
  / in-progress states. It is payload-free and does not change query behaviour.
- All eleven contract checks were receipted at `75b3cc80`, with zero new Clippy
  diagnostics.
- Independent review ACCEPTed with no blocking issues (session `690ae0dc`).
  Five non-blocking notes are recorded in ADR-0025.
- `dbd02b2c` corrects ADR-0025's stale "no loopback fixtures" claim.

### Harness and documentation fixes

- `ca183bf1`: the cargo libtest safeguard now accepts rustdoc's merged-doctest
  timing trailer. This was falsely failing `spareval --all-features`.
- ADR drift corrected: ADR-0043 said "application work remains paused"
  (`b35d4f1a`); the CLI README said 5 metric families / 60 samples
  (`0a6efbed`); the delivery-gates doc listed delivered work as pending
  (`91a7799b`); ADR-0008's counts are now scoped to the historical pin.

## 3. Open defects and limits (not failures to hide)

1. **Streaming-reset stall, `run-qIJGBC`.** Once in ten receipted runs at
   `5783f5e7`, the query observation did not end within 10 s of a client reset.
   It did not recur in 25 unreceipted diagnostic runs, nor in ten receipted runs
   at `f171a100`. Nothing in `f171a100` is known to cure it, so it stays open and
   undiagnosed. Its state was never captured. The test is un-ignored, so it can
   make the default CLI suite fail intermittently until the stall is found.
2. **`sparql_query_eval` fuzz** cannot produce mutation evidence in the
   AGENTS.md one-minute run: it spends the minute replaying a 14199-file seed
   corpus (`run-tSYzGW`, `run-UiSpQb`). `sparql_update_eval` is genuine mutation
   evidence (`run-rktpZc`). The crash and OOM artifacts dated 2026-09-08/09 in
   `fuzz/artifacts/sparql_query_eval/` predate this session and have not been
   triaged.
3. **E3 skip-worktree blocker**, described in section 2.
4. The **5 SHACL selected failures** in section 2.
5. **G4.2 task spec error**: its `--bin oxigraph workload::` command matches
   zero tests, because `workload` is a library module. The `--lib` form passes
   71/71. This is recorded in ADR-0027.

## 4. Remaining programme work

From the gate catalogue in the earlier handover and
`docs/plans/oxigraph-delivery-gates.md`. ADR-0044 classes, abbreviated:
Class A is buildable engineering; Class C is production calibration and
promotion.

| Work | Class | Next concrete step |
| --- | --- | --- |
| E4 reviewed suite evidence transition | A | Suite passes 560/560 (`run-RbLLo0` at `cf47b9b2`, review ACCEPT of `7931a493`); do the ADR-0046 evidence transition review |
| ADR-0047 upstream question | watch | Check w3c/data-shapes#1276; follow ADR-0047's revisit section when answered |
| E3 skip-worktree | A, needs a decision | Embed the full pinned tree, or define a reviewed "partial corpus" notion |
| G3.5 remainder | A | Planner, catalog, source selection, bound batching; each needs a semantic proof against the `75b3cc80` baseline |
| G3.2 | A | Frozen-corpus differential harness; revalidate the ADR first |
| G3.4 | A | Indexed-versus-oracle spatial equivalence across 24 relations |
| G4.5 | A | Leased HTTP transactions under ADR-0030 |
| G4.4 stage 3+, G4.6, G4.7 | A | Slice by explicit dependencies and consumer contracts |
| G4.8 | A | Eligibility oracle, then analytical evaluators |
| G4.3 | A | Exact residual audit; keep the completed ENOSPC and process-kill audits |
| Streaming stall | A | Capture state on failure; the instrumented diagnostic approach is below |
| G1.7, qualification, promotion, publication, push | outside ordinary delivery | Needs separate explicit owner authority |

For the stall: a diagnostic variant of the test that dumps
`oxigraph_queries_total`, admission-active and cancellation counts on timeout
was used this session. Run it through the harness so a stall produces a
receipt with captured state.

## 5. How this session worked (repeat the good parts)

- **Every numeric or empirical claim must cite a harness receipt.** The
  reviewers rejected every unreceipted figure: a "1 in 6" flake rate, a host
  load average, isolation runs, and a "five of five" negative control. The
  harness does **not** refuse a dirty tree; it records it. A deliberately
  patched negative control is therefore receiptable in place: patch the working
  tree, run through the harness, restore. The receipt's tracked-diff hash proves
  exactly what was patched.
- **Never write "the commit that adds this" in an ADR.** It goes stale on the
  next record-only commit. Name the commit hash explicitly.
- **Rebind receipts after every code commit.** Receipts bound to an earlier
  commit were rejected. Receipts from later docs-only commits stay valid; say so
  explicitly in the ADR.
- **Clippy:** compare per-target `generated N warnings` and
  `for further information visit` counts against a baseline taken on the same
  source. A `(file, lint)` normalization hid one of three new diagnostics once,
  because two lints fired on one line.
- **Pinned checkout contamination:** tooling hooks write `.claude-flow`,
  `.swarm` and `ruvector.db` into whatever directory a process runs in. Running
  anything from inside `target/w3c/shacl-1.2/data-shapes-0ccfab4f2832` dirties
  the pinned checkout, and the verifier then correctly refuses it. Always run
  from the repo root, and set `CLAUDE_FLOW_STATE_DIR=/tmp/cf-state` for suite
  runs. Contaminated files were moved, never deleted, to
  `target/engineering-delivery/resume-claude-20260922/checkout-contamination-quarantine/`.
- **Launching native reviews:** use literal absolute paths, not shell
  variables, in `nohup` commands; an unset variable once wrote to `/`. Do not
  run `pkill -f` with a pattern that also matches its own shell.
- **Rate limits:** one Fable review ended on a 429 rate limit with no verdict
  (`review2.json`). Long reviews can hit subscription limits. Wait out the
  window; do not reroute to another provider.

## 6. Evidence locations

| What | Where |
| --- | --- |
| G4.2 reviews (11 files) and evidence | `target/engineering-delivery/g42-application/` |
| OxHTTP negative-control local logs (superseded by receipts) | `target/engineering-delivery/g42-application/oxhttp-negative-control/` |
| E4 diagnosis, progress, custom-function analysis | `target/engineering-delivery/adr0046-e4/` |
| G3.5 proposals, oracle, Clippy baselines, review | `target/engineering-delivery/g35-observation/` |
| E3 repair record and review | `target/engineering-delivery/resume-claude-20260922/e3-repair3*`, `e3-review3.json` |
| Native launch helper | `target/engineering-delivery/resume-claude-20260922/native-print.mjs` |
| Node 20 runtime | `/tmp/n3-compat-review.c20LiZ/node-v20.20.2/node-v20.20.2-linux-x64/bin/node` (tmp; recheck) |

`target/` is ignored local evidence. It is not in Git and exists only on this
machine. Do not run `git clean`, and do not delete `target/`.

## 7. First-session checklist

1. Verify `main`, HEAD `dbd02b2c` (or later), a clean tree, and that nothing is
   pushed.
2. Read this document, the 2026-09-22 handover, AGENTS.md and the relevant ADR
   before touching a gate.
3. Recheck the Node 20 path; `/tmp` may have been cleared.
4. Pick the next dependency-ready Class A slice from section 4. Freeze a source
   identity, dispatch independent implementation and oracle contributors on
   Opus, apply them, receipt everything on clean committed source, get an
   independent Opus review, then update the ADR with explicit commit hashes.
5. Do not push, publish, qualify, promote or run any `g1.7:*` command without
   separate explicit owner authority.
