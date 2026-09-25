# Oxigraph programme handover (pre-harness-refactor) - 2026-09-25

## Start here

This handover is the boundary before the ordinary-engineering harness refactor
proposed in
[ADR-0048](../adr/0048-ordinary-engineering-harness-repair-and-learning.md). It
continues
[the 2026-09-23 handover](2026-09-23-claude-programme-handover.md). Read that
one first for the gate catalogue and earlier history, and its section 0 for
the resumed session of 2026-09-23. Where this document disagrees with it, this
document wins.

The programme is **not complete**. The session was paused by the owner on
2026-09-23 while a full library test run was in flight. Nothing is half-applied
in source; one receipt run was interrupted (see "Open at the pause").

### Verified state at handover

| Item | State |
| --- | --- |
| Checkout | `/home/claude/src/hm/oxigraph`, canonical `main` |
| HEAD | `ca26220e53f1c2f9e224f5557dd4bc40b5d43a7f` (before this document's commit) |
| Working tree | clean (tracked diff hash is the empty-string SHA-256) |
| Relation to remote | 295 commits ahead of `origin/main`; **nothing pushed** |
| Running model or build processes | none |
| Pinned W3C candidate checkout | clean at `0ccfab4f` |
| Parallelism | owner rule: at most one model process and one build or test at a time (`AGENTS.md`) |
| Publication, G1.7, qualification, promotion, push | none authorized, none performed |

## 1. What changed after the 2026-09-23 handover

Commits after the 2026-09-23 handover's section 0 was written, in order:

| Commit | Author | What |
| --- | --- | --- |
| `918d3566` | this session | Pins the two legacy-upgrade metadata refusals (G4.3 audit item 1) |
| `3f6d7401` | this session | Pins that recovery never adopts a one-shot preparation workspace (item 6) |
| `6b98c904` | this session | Withdraws audit item 5 as already covered |
| `ab8786bf` | this session | Places the derived-index item behind profile admission |
| `22e13f38` | this session | Real process kill at every receipt-backup phase (item 3, backup half) |
| `44f68397` to `ca26220e` | owner, 2026-09-24/25 | ADR-0048 proposal: repair ordinary harness policy drift |

### ADR-0048: the harness refactor this handover precedes

ADR-0048 is **Proposed**, not accepted. It proposes a bounded repair of the
ordinary engineering harness, not a rebuild. The main defect it records is that
`runWorkflow` in `tools/engineering-harness/src/workflow.mjs` still invites
native contributor fan-out, and `workerOutput` accepts active contributor
arrays. Both contradict the owner's one-process rule.

It has three slices, O0 to O2, and states that "current authorization covers
this ADR only". Source changes, native execution and live task writes need the
owner's explicit scoped authorization. It also records that the project MCP
connection available when it was written served another project, not Oxigraph.

ADR-0048 is not yet listed in `docs/adr/README.md`. The index still says 47
decisions.

## 2. Programme state

### Done and independently reviewed

| Item | Evidence | Record |
| --- | --- | --- |
| Upstream SRL question filed as `sparkling` | https://github.com/w3c/data-shapes/issues/1276 | ADR-0047 |
| SRL reading B (inline `DATA` not in the frozen graph) | `fede6934`, `a660b3fd`; review ACCEPT | ADR-0047 |
| Declared SPARQL functions | `0e909e38`, `7931a493`, `9c32bc87`, `ea67fc6e`; ACCEPT after one REJECT | ADR-0046 |
| W3C SHACL candidate suite | 560 of 560 selected (`run-EP2SWE` at `70c6657e`) | ADR-0046 |
| E3 skip-worktree blocker | `645f176b`, `70c6657e`; review ACCEPT | ADR-0046 |

### Done, no independent review yet

| Item | Evidence | Record |
| --- | --- | --- |
| G3.5 `SERVICE` failure-disposition baseline | `8e53c556`; `run-V0Pr3O`, `run-bwMOzJ`, `run-V63Ew2` | ADR-0025 |
| G3.4 24-relation equivalence | `run-mMO5iz`, `run-lzXwCP` at `276442ba` | ADR-0024 |
| Streaming-reset stall: state captured on timeout | `6e3432dd`; 20/20 series | ADR-0027 |
| G4.3 metadata refusals | `918d3566`; `run-ORC4yi`, `run-ikFMeU`, `run-ZLabhC` | ADR-0028 |
| G4.3 one-shot workspace refusal | `3f6d7401`; `run-RaKEuN`, `run-5mn7Uh` | ADR-0028 |
| G4.3 receipt-backup real kill | `22e13f38`; `run-ewq2Tl` (2 passed) | not yet in ADR-0028 |

### Open at the pause

1. **Interrupted receipt.** `run-u2Peiz` (`cargo test --locked -p oxigraph
   --lib` at `22e13f38`) has only `input.json`: the pause interrupted it. Rerun
   it, and do not cite `run-u2Peiz`.
2. **ADR-0028 record for `22e13f38`.** The receipt-backup real-kill test is
   committed but not recorded in ADR-0028. It passes (`run-ewq2Tl`). Moving the
   pre/post-rename boundary by one phase in either direction makes it fail
   (checked locally). Its two Clippy diagnostics are `tests_outside_test_module`,
   which every test in that module reports.
3. **G4.3 item 3, restore half.** `restore_inner` in
   `lib/oxigraph/src/store/restore.rs` needs the same real-kill treatment as
   the backup half.

## 3. Remaining programme work

| Work | Class | Next step |
| --- | --- | --- |
| G4.3 residuals | A | Restore-half real kill; real-OS `fsync` faults (audit item 2) |
| G4.3 profile admission | owner decision | Whether version 3 becomes the current schema on ordinary open. The derived-index item depends on it |
| ADR-0048 harness repair | owner authorization | O0 to O2 as the ADR describes, once authorized |
| G3.5 planner | A, large | Catalogue, planner and a result-equivalence oracle against the unplanned baseline |
| G3.2 | A, large | Frozen-corpus differential harness |
| G4.4 stage 3+, G4.5 | A, large | Leased HTTP transactions (ADR-0030) |
| G4.6, G4.7, G4.8 | A | Slice by dependency; G4.8 eligibility oracle first |
| Streaming-reset stall | watch | Diagnose from the first captured recurrence |
| ADR-0046 open notes | A, small | GeoSPARQL name override choice; `sparql:` declarations; function registration outside `sh:sparql` constraints |
| Push, G1.7, qualification, promotion, publication | owner authority | Not authorized |

The G4.3 residual audit is at
`target/engineering-delivery/g43-residual-audit/audit.md`. ADR-0028's
2026-09-23 section records which of its items are done, withdrawn or deferred.

## 4. How to work here (lessons from this session)

- **One process at a time.** One model-bearing process, and one build or test
  command. Wait on a background process by PID (`kill -0 <pid>`), never with
  `pgrep -f` on its command line, which matches the waiting shell too.
- **Receipt everything through the harness** (`oxigraph-delivery.mjs run`),
  on clean committed source. Generate evidence rows with
  `node tools/evidence/receipt-evidence.mjs run-...`: it flags dirty receipts
  and counts every compiler warning. Check an ADR before review with
  `node tools/evidence/adr-prereview.mjs [--allow-commit HASH] FILE.md`.
- **Test every feature set that applies.** Run default and `--all-features`
  tests, and Clippy for default, all and no-default features. `rdf-12`-gated
  tests once hid three failures. For `oxigraph`, `--all-features` needs system
  RocksDB, which this host lacks; use the feature set the existing receipts use.
- **Negative controls must change one side only.** A control that alters both
  the fault point and the expectation proves nothing; this happened once in this
  session and was caught. Break the code or the expectation, not both.
- **Never `git checkout -- <path>` with uncommitted work** to compare against
  an older commit. It destroyed uncommitted fixes once. Use `git stash`, or
  `git show <rev>:<file>` into `/tmp`.
- **Format only your own hunks.** Stable rustfmt disagrees with the repository's
  nightly settings on older code. Check touched files with
  `rustfmt --edition 2024 --check`, and apply the formatter only to new code.
- **Keep the pinned checkout clean.** Hooks write `.claude-flow` and `.swarm`
  into whatever directory a command runs in. Run from the repository root with
  `CLAUDE_FLOW_STATE_DIR=/tmp/cf-state`. Quarantine (move, never delete)
  contamination to
  `target/engineering-delivery/resume-claude-20260922/checkout-contamination-quarantine/`.
- **Launch native reviews** with
  `target/engineering-delivery/resume-claude-20260922/native-print.mjs <model>
  <effort> <prompt> <output> [tools]`, using literal absolute paths. Give the
  reviewer the receipts and ask for all defects in one pass.
- **Node 20** is at
  `/home/claude/.local/share/mise/installs/node/20.20.2/bin/node` (ADR-0048) and
  also `/tmp/n3-compat-review.c20LiZ/node-v20.20.2/node-v20.20.2-linux-x64/bin/node`
  (temporary). The harness receipts only the Node it runs under.

## 5. First-session checklist

1. Verify `main`, a clean tree, HEAD at this document's commit or later, and
   that nothing is pushed.
2. Read this document, the 2026-09-23 handover (sections 0 and 5), `AGENTS.md`
   and ADR-0048.
3. Ask the owner which comes first: the ADR-0048 harness repair (needs explicit
   authorization) or the open G4.3 items. Do not start ADR-0048 slices
   without that authorization.
4. If G4.3: rerun the interrupted library test run, record `22e13f38` in
   ADR-0028, then do the restore half.
5. Do not push, publish, qualify, promote or run any `g1.7:*` command without
   separate explicit owner authority.
