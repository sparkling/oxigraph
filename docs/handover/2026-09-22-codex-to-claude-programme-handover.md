# Oxigraph programme handover to Claude - 2026-09-22

## Start here

Continue the existing programme in this checkout. Do not restart completed
implementation, redesign the harness, or treat the old pause as current.
The owner's latest programme instruction is:

> resolve all blockers, do not stop until programme complete, stop pausing and stopping

The subsequent instruction requests this handover because work is moving to
Claude. This is a session transfer, not programme completion or withdrawal of
implementation authority. Programme remains incomplete.

**Immediate next action:** reconcile the already-applied E3 candidate in a fresh
engineering workflow, run its focused Node 24/20 checks, obtain independent
review of the complete six-file delta, then commit. E4 follows. G4.2 proposals
are ready for integration after their own fresh source reconciliation.

### Verified transfer state

| Item | State at handover |
| --- | --- |
| Checkout | `/home/claude/src/hm/oxigraph`, canonical `main` |
| Implementation HEAD before this handover commit | `97e68ba778fb56a4dfa12287993f9eab554c9372` |
| Remote relation before this handover commit | 222 local commits ahead of `origin/main`; no push performed |
| Uncommitted product work | Exactly six E3 files, listed below; initial proposal AND repair2 applied |
| E3 validation after repair2 | Not run; no acceptance or completion claim |
| E3 workflow | Both attempts terminal/incomplete after host-response timeout |
| G4.2 source | No tracked application; repaired proposals remain isolated under `target/` |
| Running work | One read-only Claude programme coordinator, observed running; recheck on arrival |
| Cargo/build work | Both Clippy baselines completed; no programme build left running by this session |
| Publication | None authorized or performed |

This document is committed separately from the unverified six-file E3 change.
Its commit changes HEAD and the full repository source identity. Therefore old
workflow source identities are history, not identities to stamp on new work.
Use `git log -1` to identify the handover commit, then freeze fresh source.

## 1. Authority, models, and operating rules

Read `AGENTS.md`, then these governing records:

- `docs/adr/0043-delivery-recovery-and-proportional-release-boundary.md`
  (Implemented; ordinary engineering workflow and current model policy).
- `docs/adr/0044-post-deployment-production-tuning.md`
  (Accepted; buildable work versus external dependencies and production tuning).
- `docs/adr/0046-shacl-12-editors-draft-realignment.md`
  (Accepted; current SHACL work).
- `docs/plans/native-agent-strategy-reassessment.md`, especially
  `Configured 9router launch`.

Current owner selection supersedes historical Codex/Astra selections:

| Role | Native client / exact 9router model | Effort |
| --- | --- | --- |
| Programme coordinator / consequential decisions | Claude / `cc/claude-fable-5-1` | `max` |
| Bounded implementation and test authoring | Claude / `cc/claude-opus-5` | `xhigh` |
| Documentation / narrow extraction | Claude / `cc/claude-opus-5` | `low` |
| Independent review | Claude / `cc/claude-fable-5-1` | `high` |
| Difficult implementation | Claude / `cc/claude-fable-5-1` | `xhigh` |

Use configured 9router Claude subscriptions. Do not use Codex workers, provider
API keys, OpenRouter, automatic model substitution, or provider-usage budgets.
Do not reinterpret a genuine native authentication/model error as authority to
change transport. Report the exact client/model/error if recovery fails.

Root is the sole tracked-source writer, Git writer, integration owner and
engineering-workflow host. Native contributors own exclusive proposal paths;
reviewers inspect stable source and must not have implemented the change.
Use canonical `main`; no branches or worktrees. Commit coherent verified
slices promptly, staging only their paths. Do not push.

All application building and testing uses
`tools/engineering-harness/bin/oxigraph-delivery.mjs`. Root must serialize
commands sharing Cargo outputs for their entire lifetime, including nested
processes. The wrapper does not provide that resource lock. Hold tracked source
stable during each check. Independent proposal/review work may overlap.

Do not impose a global native session cap or launch idle workers to fill slots.
Dependencies, exclusive file ownership, useful work and host resources control
allocation. Native client limits still apply. Historical successful independent
sessions do not prove infinite capacity or a throughput gain.

Ordinary delivery is authorized. G1.7, protected qualification, promotion,
publication, deployment and remote pushes retain their separate authority
boundaries. Do not modify protected runtime stores except through already
authorized task/control/evidence operations. Do not refresh historical pins,
expected results, receipts or profiles to make a candidate pass.

## 2. Source and artifact preservation

All paths below are relative to the checkout unless absolute. The working
artifact base, abbreviated **BASE** in prose, is:

`target/engineering-delivery/resume-claude-20260922/`

BASE is ignored local evidence, not a Git-tracked handover bundle. Continue on
this machine and preserve it. A clone containing this document alone does not
contain proposals, native transcripts or run receipts. Do not run `git clean`,
delete `target`, overwrite old output files, reset source, or stage everything.

The six uncommitted E3 files exactly match BASE's `repair2/` copies:

| Path | SHA-256 at handover |
| --- | --- |
| `tools/shacl-tests/clause-audit.mjs` | `7c9f18c1884ce3ed0052329c0c7d5dc6daa8475138594c3fefa64a4e9da918dc` |
| `tools/shacl-tests/shacl-requirements.mjs` | `b123b29856b92ceedd9ee426825394557ab08291cd210cd411153b67dc504afc` |
| `tools/shacl-tests/clause-reviews.mjs` | `8f0cb232081708498537e4e1216736f2db402c45c6a9366d43112326d0c330f8` |
| `tools/evidence/policy.mjs` | `9b2d8f35a39783e2302fc769924130a75bfc20604ec15c32ea34c0c3cf07cb61` |
| `tools/evidence/verify-programme.mjs` | `29f9acc69560e63fd3c8c788c7bef7e31da3a27f8cd7b04652a1e0b14f744e8a` |
| `tools/evidence/verify-programme.test.mjs` | `3173139305c79835ff543f3b3a004213b86ca01b072f45edf8d36c04044aebe9` |

Machine-readable snapshot: BASE `handover-source-snapshot.json`.
Before the handover commit, workflow source identity was
`85dfb879b03989bc67de80dd65ace80f2261ae47ffb8c69cc354a3b31c61e441`.
The prior pre-repair identity was
`dcab2d994d20dd1f919eb1ca1dbe70e87f9f7efd7aec1cebc1d83de3fd18500d`.
Neither is a Git commit or the identity of the post-handover checkout.

`verify-programme.test.mjs` is 515,076 bytes, close to the workflow's 524,288-byte
per-file ceiling. Keep additions concise. Much of its initial diff rewrapped
embedded base64. Earlier byte comparison confirmed these decoded corpora stayed
unchanged; repeat a byte comparison if touching their serialization:

| Embedded corpus | Decoded bytes | SHA-256 |
| --- | ---: | --- |
| `oracleCandidateCorpusBase64` | 274752 | `45d0d41be51800591efed07a5bcd5bdc7f10d41ea82ef6f12460d8745128ce7c` |
| `oracleCandidateGitObjectsBase64` | 38962 | `fe03faef15b7b4a215e62ec988c735a655336853f926d1f72774d6ba4728cd0e` |

## 3. E3: exact state, failure, repair and acceptance

Task: `task-1789920942563-yx72lt`, live state last read as `in_progress`, 10%.
That percentage is stale bookkeeping, not a completion measurement.

Already committed prerequisites:

- E2 candidate suite evidence contracts: `049e81c9`.
- Complete ground SRL DATA: `2e63c6920a9c51e7b078d9a87c3070f6a8fb3978`.
  Acceptance: `target/engineering-delivery/adr0046-srl-data/accepted-EGzKud.json`.
- SRL BNODE identity / RDF term transport:
  `f706742b17e6674360c34cf6bdfc3b1b59ab59f3`.
  Acceptance: `target/engineering-delivery/adr0046-srl-bnode/accepted-8tVvxP.json`.
- Claude-only harness routing: `97e68ba7`.

E3 adds distinct candidate document/facet mappings and immutable
source/run/inventory-bound clause evidence. It preserves historical mappings
and separates SPARQL-RL from SHACL Inference Rules. The candidate includes full
normalized anchor-body hashes, structural HTML containment, raw BCP14 joins,
deterministic duplicate/unjoined occurrences, explicit unsupported residuals,
and exact accepted D/N identities. Unjoined raw clauses are not declared proved.
The GD/G0 specification discrepancy remains explicit.

### Failed attempts remain evidence

| Attempt | Result |
| --- | --- |
| `target/engineering-delivery/workflow-v0JVs6/` | Run ID `17778c28-b0e0-40ca-b0b3-479f70c40d15`; initial six-file proposal applied, focused check failed; later host timeout |
| `target/engineering-delivery/run-EPGLnb/` | Node focused check: 29 passed, 9 failed, exit 1, source stable |
| `target/engineering-delivery/workflow-d1O8d5/` | Run ID `ac25cb2d-9458-447a-bb7e-7f8c01e7e93a`; repair applied through request 5; terminal before checks |

Both workflow `failure.json` files must remain intact. The second says
`Host action timed out after 30 minutes`, `eventCount: 5`. Last request is
`request-6.json`, action `mcp-read`; the process exited 2 before its response
could advance validation. There is no live workflow to resume and no accepted
E3 result. Do not reuse its response envelope in another run.

### Repair now applied

1. Pinned `shacl12-node-expr/index.html:4023` contains an empty ReSpec
   `<section id="index">`. Producer `anchoredText` and independent verifier
   `candidateClauseAnchoredText` rejected valid empty normalized prose.
   The repair removes that empty-string rejection only. Missing/unclosed anchor
   checks, full-body hashing and containment joins remain. Empty content hashes
   to SHA-256 of the empty string.
2. `rules-rdf-syntax-boundaries.residual` omitted the explicit
   `sh:SPARQLRuleTemplate` boundary required by the oracle. Its exact new text is:

   > The programmatic Rust Datalog rule API is not an RDF sh:TripleRule or sh:SPARQLRuleTemplate compiler. The two sh:SPARQLRuleTemplate fixtures and two sh:TripleRule fixtures remain predeclared unsupported.

3. Only the uncommitted candidate obligations digest changed in the policy and
   independent assertion: old `7906169a5c13de1cd16071fd30f34361467a1bbbecdc237ca8384cdf1b0fc9e0`,
   new `20b00a0d637257d16a13e0cb480ed79b86933fb3f30e2caa32f074abef8ca521`.
   There are 38 obligations; only that residual field changed. The original
   digest was reproduced before changing it and the new serialization hash was
   independently checked with Python. This does not alter historical pins.
   `candidateResidualClaims` remains unchanged with digest
   `46f21e8957852eb7ba03e9611a28477d6f6933bc3d6fe5f31dc4f4828cfe7b92`.

BASE contains `e3-repair2.diff`, `e3-residual-digest.json`,
`e3-corrected-obligations.json`, full `repair2/` copies and native output.
Five repair files changed; the sixth (`shacl-requirements.mjs`) is unchanged
from the initial reconciled proposal. Root compared all applied bytes against
the requested contents.

### Native authorship and review independence

| Work | Claude native session | Result |
| --- | --- | --- |
| Initial reconciliation | `6caf7e46-a901-4f1c-b3ab-05f6dc5aa823` | Initial applied proposal; BASE `e3-implementation.json` |
| Empty-anchor repair | `40836173-e0ad-4c69-9094-d03a82ab8099` | INCONCLUSIVE overall, useful two-file fix preserved; `e3-repair1.json` |
| Repair2 synthesis | `d3890790-362e-4321-b70e-9280e4d36291` | ACCEPT as implementation proposal; `e3-repair2.json` |

Repair workers used `cc/claude-opus-5` / `xhigh`. Repair2's response explicitly
says some supplied diff lines were lossy; it is not proof of full hunk review.
Its acceptance remains conditional on deterministic checks and independent
review. Root verified actual files. The final reviewer must read actual source
and the cumulative delta from `97e68ba7`, not just the small repair diff.
Exclude all implementation authors, including historical contributors in the
original E3 proposal records, from final review. Preserve their identities;
never relabel a historical Codex execution as Claude.

### Resume E3 without redoing implementation

1. Check branch, HEAD, dirty paths and the six hashes. Inspect any difference
   before writing. Read live task/control through MCP.
2. Start a fresh workflow with BASE `e3-task-spec.json`. It already removes old
   explicit Codex overrides. A native Claude implementation session must
   reconcile the existing candidate against the fresh request/source identity.
   If sound, it can return ACCEPT with `changes: []`; the implementation exists.
   Do not replay an old result under a new identity without reconciliation.
3. Run the focused Node check in that workflow. Also run the identical check
   through the delivery wrapper hosted by Node 20 on the same candidate.
4. Repair actual remaining failures through Claude and the existing workflow.
   Do not change fixtures, exclusions or pins to turn failures green.
5. Fresh independent Fable/high review covers all six files and full check
   receipts. Explicitly supply historical authorship exclusions and the
   cumulative diff; a repair-only workflow otherwise shows only its own delta.
6. Complete the exact MCP evidence store/readback, commit only the six verified
   files, update task/control and activate E4. Correct stale status prose as a
   separately scoped documentation slice, with truthful evidence references.

## 4. Existing harness: exact operating instructions

Entrypoints and contracts:

- `tools/engineering-harness/bin/oxigraph-delivery.mjs`
- `tools/engineering-harness/src/workflow.mjs`
- `tools/engineering-harness/src/workflow-host.mjs`
- `tools/engineering-harness/src/delivery.mjs`
- `tools/engineering-harness/src/native/environment.mjs`

Start the workflow from the repository root:

```bash
node tools/engineering-harness/bin/oxigraph-delivery.mjs workflow \
  --spec target/engineering-delivery/resume-claude-20260922/e3-task-spec.json
```

This is a JSON-line bridge, not a self-executing model scheduler. The active
Claude host services each emitted `host-request` by reading its exact `path`.
Replies preserve `schema`, `runId`, `requestId`, `taskId`, `specSha256` and
`sourceSha256`, omit `action`/`payload`, and add `result`.

- `mcp-read`: live `task_status` and exact `memory_retrieve`.
- `native-worker`: execute the requested native Claude route; return exact
  `status`, `client`, `workerId`, `model`, `effort`, `summary`, `verdict`,
  string-array `findings` and `changes: [{path, content}]`.
- Contributor records declare native identity, model/effort, exclusive paths,
  current `sourceSha256` and concrete selection reason. Never merely relabel a
  stale contribution. Review contributors may overlap scopes.
- `root-apply`: first compare `beforeFiles` with disk, apply exact proposed
  contents, compare again; acknowledge `{"writer":"root","applied":true}`.
- `mcp-handoff`: store the exact evidence using strict insert, retrieve it and
  verify equality before replying.

Reuse `relayWorkflowHost` exported from `workflow-host.mjs` for mechanical MCP
actions. Inject live callbacks named `taskStatus`, `memoryRetrieve`,
`memoryStore`. This session serialized that function into a Codex isolate;
that in-memory object is not portable. Claude should import/read the existing
function, not build another scheduler or assume Codex tool handles exist.

Each host action has a 30-minute turnaround timeout. Prepare compact context
and service requests promptly. If it expires, retain the failed run and start
a fresh reconciled workflow. Never edit failure evidence into success.
When using a PTY, disable echo/canonical input (`stty -echo -icanon` in that
PTY) before launch: full-file responses can exceed terminal line limits. A
pipe-capable persistent process avoids the PTY limit. Responses can approach
1 MB; do not dump full embedded corpora into the conversation.

Current supported Node was 24.14.1. Existing Node 20 executable:

`/tmp/n3-compat-review.c20LiZ/node-v20.20.2/node-v20.20.2-linux-x64/bin/node`

Verify it still exists. Run supplemental E3 checks with these commands,
serially and on stable source:

```bash
node tools/engineering-harness/bin/oxigraph-delivery.mjs run \
  --task task-1789920942563-yx72lt \
  --check 'E3 candidate evidence contracts pass with positive test count on current Node' \
  -- node --test --test-reporter=tap tools/evidence/verify-programme.test.mjs

/tmp/n3-compat-review.c20LiZ/node-v20.20.2/node-v20.20.2-linux-x64/bin/node \
  tools/engineering-harness/bin/oxigraph-delivery.mjs run \
  --task task-1789920942563-yx72lt \
  --check 'E3 candidate evidence contracts pass with positive test count on Node 20' \
  -- node --test --test-reporter=tap tools/evidence/verify-programme.test.mjs
```

Check the receipt's actual runtime/command, `sourceStable`, exit status, test
count and full logs. Do not mistake a route plan or a zero-test run for proof.

### Native Claude launch

BASE `native-print.mjs` is the existing local launch helper, not a scheduler:

```bash
node target/engineering-delivery/resume-claude-20260922/native-print.mjs \
  cc/claude-fable-5-1 high /absolute/path/to/review-prompt.txt \
  /absolute/path/to/new-review-output.json
```

Arguments are model, effort, prompt file, output file, optional toolset.
Default toolset is `Read,Grep,Glob`. Proposal writers previously used
`Read,Grep,Glob,Edit,Write`, restricted by prompt to their isolated proposal
paths. An empty toolset supports small self-contained decisions. Use unique
output names: the helper creates files exclusively and will not overwrite.

It launches `/home/claude/.local/bin/claude` with `--safe-mode --print
--no-session-persistence`, exact model/effort and `dontAsk`, forwarding only
the existing `CLAUDE_CONFIGURATION_ENV` allowlist before
`nativeChildEnvironment("claude")`. Safe mode skips settings loading; omitting
that forwarding previously lost the configured 9router connection. Do not
print credentials, expand the allowlist, or read provider keys.

Current helper writes `.events.jsonl`, `.stderr` and final result JSON.
Inspect native `session_id`, `is_error`, result and actual model evidence;
the helper's zero exit alone is not content acceptance. Older workers launched
before streaming was added buffer output until completion.

## 5. E4: ready after accepted E3 commit

Task: `task-1789927576007-zcy5h6`.
Exact prepared commands and criteria:
`target/engineering-delivery/adr0046-e4/readiness.json`.
Its preparation HEAD is old; D/N is complete and E3 remains the dependency.

- Candidate suite commit: `0ccfab4f28324edaac59a1227f8c60ad5b7bbf89`.
- Suite SHA-256: `fa1ff95904600c553036123fd6eef66ad281a934830673ee7e9402b3257a3376`.
- Inventory: 569 declarations; 560 selected, seven predeclared unsupported,
  two excluded. These are expected inventory categories, not observed passes.
- SRL: 203 manifest cases, not the 198 `.srl` file count.
- Inference Rules: 21 declarations, including 14 selected and seven unsupported.
- Independent compact-syntax comparison: 32 selected fixtures.
- Maven `/home/claude/.local/bin/mvn`, Java `/usr/bin/java` were available;
  recheck before use.

On clean committed source, run the readiness file's three exact delivery
commands serially: `node tools/shacl-tests/run.mjs`, then
`node tools/shacl-tests/clause-audit.mjs`, then
`node tools/shacl-tests/jena-compact.mjs`, all behind the delivery `run` wrapper.
Keep tracked source frozen throughout. Inspect immutable revision/source/run
artifacts and obtain independent review. A selected failure remains a failure;
do not move it into unsupported/excluded after seeing results.

Then update ADR-0008, ADR-0046 and current SHACL status documents with exact
results and limitations. Ordinary suite execution is not qualification,
promotion, complete normative conformance or publication.

## 6. G4.2: repaired proposals ready, application and checks pending

Task: `task-1787728711461-3isex6`.
Original proposals/spec/readiness: `target/engineering-delivery/g42-cancellation/`.
Current repaired copies: BASE `g42-repair/`. Preserve both generations.

Six original owned source paths, all baseline hashes verified before E3 repair:

- `lib/spareval/src/eval.rs`
- `cli/src/workload/metrics.rs`
- `cli/src/workload.rs`
- `cli/src/operations.rs`
- `cli/src/workload/tests.rs`
- `cli/tests/access_http.rs`

Two additional documentation proposals are `cli/README.md` and
`docs/adr/0027-workload-admission-and-operator-resources.md`. Either admit them
explicitly in a fresh workflow or deliver a separate documentation slice;
the old six-path spec does not authorize silently adding them to its response.

### Completed native work

| Artifact in BASE | Native session | Outcome |
| --- | --- | --- |
| `g42-review.json` / `g42-review.txt` | `99228b05-31f5-4a77-bca9-791b2b061e0f` | Fable/high, INCONCLUSIVE with concrete defects |
| `g42-production.json` | `3a5d98ff-4627-42f6-b701-812427ff6e0e` | Opus/xhigh, repaired production and docs proposals, ACCEPT pending checks |
| `g42-oracle.json` | `77fd62b1-4531-4cdd-b362-aa1ddf9c6aae` | Opus/xhigh, repaired two test proposals, ACCEPT pending checks |
| `g42-clippy-gate.json` | `b8a87f42-2910-4e27-a385-ddbecae669de` | Fable/high, accepted scoped no-new-warning comparison contract |

Production repair removes a new `expect_used` in cancellation signal handling
using `if let Some(&signal_at)`, retaining explicit-first/deadline fallback.
Docs use six metric families and 100 admission samples; combined example is
563. Historical counts remain history. ADR-0027 stays Proposed; proposal prose
says implementation-pending and must be updated truthfully after delivery.

Oracle repair completed during handover preparation. It:

- Replaces fragile 1 ms active timeout with 40 ms and waits to the deadline,
  retaining strictly-after and causal assertions.
- Executes write/rollback/restart checks before emitting success fields.
- Consolidates drill stdout and narrowly expects `clippy::print_stdout` with
  an explicit machine-readable-output reason; removes new `unused_mut`.
- Adds operator-pool timed-out cancellation-latency coverage.
- Adds a non-ignored Linux streaming `/query` reset test proving cancellation,
  histogram deltas, slot release and write/rollback/restart behavior.
- Preserves queued-expiry no-latency and response-binding/reset assertions.

No G4.2 repaired proposal has been applied, compiled, tested or independently
accepted as final source. Contributor ACCEPT is proposal-level only. Rehash
the repaired files; original proposal hashes are stale. Preserve frozen shared
interfaces documented in the proposal prompts and review. Do not assume the
new narrow lint expectation or timing test passes until checks run.

### Clippy baselines and accepted gate correction

| Configuration | Receipt | Exit/source | Complete stderr SHA-256 |
| --- | --- | --- | --- |
| Default | `target/engineering-delivery/run-Q9GOCR/` | 0, stable | `80d561bf5bcde02879225c38ad3ad65bcb54de3d6f76663e23047399613da529` |
| No default features | `target/engineering-delivery/run-pEK5j9/` | 0, stable | `0d7849c210eb53101826b03f3a2b457155f9d5a9f1a64e251bd7b185e3e3ddf6` |

Exact argv are `cargo clippy --locked -p oxigraph-cli --all-targets`, with
`--no-default-features` appended for the second. Default parsing is in BASE
`g42-clippy-baseline.json`: 241 warning blocks across 32 files, including
summary blocks. This is not 241 unique warnings and neither run is warning-free.
No-default baseline finished successfully; its detailed normalization remains
to be done. Both precede G4.2 application.

The old task's absolute zero-warning wording was an unverified coordinator
overclaim, not a user criterion or protected expectation. The native review
accepted comparison against pre-existing diagnostics. Preserve the old spec;
make a fresh Claude-routed spec with the reviewed contract:

1. Compare identical argv/configurations and verify source/command receipts.
2. Normalize diagnostics by file, message/lint and source item/line contents,
   not shifting raw line numbers; exclude summary/duplicate-count lines.
3. Map changed spans with the source diff. Reject new diagnostics in G4.2
   changed hunks and any per-file/per-lint count increase elsewhere.
4. Report the full existing diagnostic set and both baseline stderr hashes.
   Do not claim exit 0 proves no warnings.

Do not add unsupported `-- -D warnings` or begin unrelated workspace lint
cleanup. Use the existing task's focused/full feature matrix, applicable
`spareval` query/update fuzz targets for 60 seconds each, fresh independent
review and exact acceptance evidence. Run the six-case 1/4/16 ignored drill
only after the instrumentation commit is accepted. Its output is demo-grade,
not numeric default calibration or production promotion.

## 7. Process transfer: what is still alive

Codex numeric process handles are host-local, not OS PIDs or Claude session IDs.
Do not pass them to shell `kill` or assume Claude can call `write_stdin` on them.

| Former handle | Job | Last observed state |
| --- | --- | --- |
| `60600` | Fable/max programme coordinator | Running, read-only, final output empty |
| `45039` | G4.2 oracle repair | Completed exit 0; result captured |
| `83076` | No-default Clippy baseline | Completed exit 0; receipt above |
| `63328` | Default Clippy baseline | Completed exit 0; receipt above |
| `30163` | E3 second workflow | Terminal exit 2; timeout recorded |
| `92132` | E3 first workflow | Terminal exit 2; timeout recorded |

Coordinator's OS launcher PID was `2057082`, command:

```text
node target/engineering-delivery/resume-claude-20260922/native-print.mjs cc/claude-fable-5-1 max target/engineering-delivery/resume-claude-20260922/coordinator-prompt.txt target/engineering-delivery/resume-claude-20260922/coordinator.json
```

Before acting on a PID, verify it still belongs to this exact command. Prompt
and `.stderr` are in BASE. This older invocation buffers stdout, so an empty
`coordinator.json` does not establish failure. It has read-only tools and no
source ownership. It was asked for sequencing and buildable follow-on work,
not authority to edit or run tests. Its input source is now stale: reconcile
its eventual recommendations with the handover and current source.

Do not duplicate the coordinator merely because output is empty. Its result is
not needed to run the already-defined E3 acceptance. Proceed with ready work
while monitoring the output. The helper's stdin is closed after its prompt;
it cannot be steered interactively. No application workflow is waiting for
this coordinator at transfer.

## 8. Live memory and task continuity

Both project `ruflo` and user `ruflo_user` MCP worked in this session. Discover
the live structured tools in Claude; host prefixes may differ. Never fall back
to Ruflo/claude-flow CLI wrappers or direct database access.

Read these exact namespace/key pairs:

| Namespace | Key | Purpose |
| --- | --- | --- |
| `programme-controls` | `oxigraph-six-hour-delivery-course-correction-v1` | Current authority/task/control |
| `programme-control-history` | `before-claude-programme-resume-2026-09-22-97e68ba7` | Exact pre-resumption state, preserved |
| `programme-native-executions` | `claude-resume-2026-09-22-97e68ba7` | Native execution snapshot; older than latest repairs |
| `programme-handovers` | `codex-to-claude-2026-09-22` | This transfer's exact source/progress pointer |
| `programme-task-evidence` | `workflow-<run UUID>` | Accepted workflow evidence; use actual IDs, not inferred success |

Control was verified to have `productWorkPaused: false` and
`ownerReviewHold.active: false`. Its older `openPriorDeliveryTasks` and
`separatePromotionRequirements` contain September 18 "declined/blocked"
conclusions superseded by ADR-0044 and later source. They are not stop orders.
The execution snapshot likewise requires refresh; retain historical evidence.

User-store `user-patterns/metaharness-phase-gating-proportionality` is
superseded. Active replacement retrieved earlier was
`metaharness-full-operational-harness-v1`; current owner Claude-only/9router
instructions supersede its mixed-provider portions. Search/list/retrieve
through the user connection, not a namespace on the project connection. If
memory is unavailable, report the exact MCP failure and continue useful work.

Ruflo `agent_spawn` returned a legacy `sonnet` label despite the requested
Fable route; `agent_update` stored exact configuration, but lifecycle status
did not display it. Treat native envelopes as model-execution evidence.
Registered coordinator ID: `claude-programme-coordinator-20260922`.
Tracking records are not proof of native execution or completion.

The protected `.ruvnet-brain/checkpoint.json` is stale (August 29 containment
work). It names `oxigraph-programme-completion.mjs` and
`scripts/loop-checkpoint.mjs`, neither present here. Do not repair the protected
checkpoint or restart containment from it. No working whole-programme
completion verifier was established; prove completion against actual gates.
The six-hour systemd timer remains disabled by the owner's earlier cancellation;
continuation does not re-enable it.

## 9. Remaining programme and dependency-based allocation

Read current source and the owning ADR before declaring any gate closed or
blocked. These are the live scope catalogues, not interchangeable status copies:

- `docs/plans/oxigraph-delivery-gates.md`
- `docs/plans/linked-data-store-evolution-harness-plan.md`
- `docs/plans/persistence-write-and-linked-data-parity-plan.md`
- `docs/adr/0044-post-deployment-production-tuning.md`

The gates document still calls completed DATA/BNODE work pending. Correct that
after the next evidenced slice; do not reimplement it. Similarly, ADR-0043's
model-amendment sentence "Application work remains paused until explicitly
resumed" describes the earlier setup moment. The owner has explicitly resumed.

| Work | Dependency / ready state | Deliverable and completion check |
| --- | --- | --- |
| E3 | Applied; ready for fresh reconciliation/checks/review | Exact candidate mappings and verifier, Node 24/20 passes, independent cumulative review, MCP acceptance, commit |
| E4 | Accepted clean E3 commit | Three immutable candidate runs, inventory conservation and selected-case results, independent receipt review, truthful docs |
| G4.2 | Proposals ready; root application serialized with SHACL | Cancellation-latency instrumentation and tests, scoped Clippy comparison, feature/fuzz matrix, independent review, commit, demo-grade 1/4/16 drill |
| G3.5 next slice | Prepared plan; recheck current source/interfaces | Opt-in HTTP SERVICE observations with independent loopback oracle; no unused endpoint catalogue |
| G3.2 | Revalidate owning ADR/source | Frozen-corpus differential harness; production speed/default claims separate |
| G3.4 | Revalidate owning ADR/source | Indexed-versus-oracle spatial equivalence across 24 relations; default promotion separate |
| G4.5 | Re-evaluate concrete workload dependencies after G4.2 | Leased HTTP transactions under ADR-0030; do not retain a blanket production-calibration block |
| G4.4 stage 3+ / G4.6 / G4.7 | Slice explicit dependencies and consumer contracts | Transaction facade, multi-repository lifecycle, incremental entailment; no completion inferred from research |
| G4.8 | Stage-specific ADR-0033 contracts | Eligibility oracle and subsequent analytical evaluators are buildable; production Auto promotion separate |
| G4.3 | Existing native coverage substantial; exact residual audit needed | Preserve completed ENOSPC/process-kill audits; distinguish remaining concrete gaps from separate frozen qualification |

G3.5 prepared packet:
`target/engineering-delivery/g35-planning/coordinator-g35-next-task.md`.
Task `task-1787851235446-7vlbgt`. It defines five paths: new
`lib/oxigraph/src/sparql/federation.rs`, existing `sparql/mod.rs`,
`sparql/http.rs`, `lib/oxigraph/src/http.rs`, and new independent
`lib/oxigraph/tests/federation_observation.rs`. Implementation owns the first
four; oracle owns the fifth. Reuse existing HTTP/egress consumers and loopback
fixtures. The packet includes interfaces, privacy/error/multiplicity contracts
and eleven focused checks. Its historical Sol/Astra routing is obsolete for
new work; use current Claude roles without rewriting its historical identity.

Practical allocation: root handles one source workflow; Claude implementation
and oracle workers prepare exclusive ready proposals; independent Claude
reviewers inspect frozen candidates/checks. The coordinator chooses dependency
order. Refill slots with acceptance/review or genuinely independent ready work,
not duplicate investigations. At transfer, E3 acceptance is ready; E4 waits on
E3; G4.2 proposal generation is complete; one coordinator is still active.
No new workers were started merely to fill capacity during handover.

ADR-0044 classification prevents another false blocked-programme loop:

- Class A: buildable implementation, evaluators, fixtures, instrumentation and
  demo-grade measurements. Large scope or a missing consumer means slice/build
  it, not defer it.
- Class B: name the actually absent physical/external dependency, including
  unresolved third-party specification questions.
- Class C: production calibration, promotion, real capacity/fairness tuning,
  and pre-result threshold freezing where required. Preserve these obligations
  without presenting them as ordinary implementation prerequisites.

Neither Class A nor this handover grants forbidden qualification/publication
authority. No whole-programme completion percentage or time estimate is proved.
Holger's earlier HTML correspondence task is outside this continuation; do not
reopen it as programme implementation work.

## 10. First-session checklist and known traps

1. Read this document and instructions; verify physical checkout and `main`.
2. Compare the six E3 hashes and inspect `git diff`; preserve all existing work.
3. Retrieve live task/control and the transfer memory; inspect coordinator
   process/result without duplicating it.
4. Reconcile E3 in a fresh Claude-only workflow and finish its acceptance.
5. Continue E4, G4.2 and remaining Class A slices using dependency readiness.
6. Record active workers, ready/blocked tasks, review queues and exact evidence;
   report concrete remaining blockers rather than stopping at a task percentage.

`cargo fmt -p` can reformat the whole workspace; prefer read-only checking.
Never overlap Cargo output users: crash tests re-exec their own binary and
another build can truncate it. Inspect npm scripts before broad commands;
repository-wide suites can include unauthorized G1.7 surfaces. Do not silently
follow specification redirects or replace historical document URLs with live
pointers. Do not infer source alignment by rendered-page keyword counts.

Final acceptance requires actual source, successful applicable checks,
independent review, exact evidence handoff and a verified commit. Native
proposal ACCEPT, a registered agent, a documentation update, a timeout recovery
or a zero exit alone does not close the programme.
