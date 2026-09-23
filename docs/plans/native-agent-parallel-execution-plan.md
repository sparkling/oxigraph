# Native Codex and Claude parallel execution

Date: 2026-09-19. Source inspected: `f6b33199` on canonical `main`, with the
Claude transport instructions updated for owner commit `8db8797a`.
Status: historical audit and superseded operating plan; application execution
paused. The owner's independent-session amendment `c63b1fef` removes the
capacity premise behind the provider allocation below. Use
[the swarm reassessment](native-agent-strategy-reassessment.md) for current
recommendations. Preserve this document's inspected facts and task inventory;
its Claude-lead allocation and launch runbook are historical options, not the
current default.

## Superseded decision

Use the existing ordinary engineering workflow, with a native Claude lead
delegating bounded read-only proposals and Codex providing integration and
independent review. Root remains the only writer. No scheduler, bridge rewrite,
capacity override, provider transport or new dependency is needed.

All subsequent application implementation, repair, review, build and test work
goes through `tools/engineering-harness/bin/oxigraph-delivery.mjs`. This plan
does not start that work. `tools/metaharness` remains the separate semantic
qualification harness.

## Evidence: capacity is not throughput

| Surface | Executable/configured behavior | Observed in this audit |
| --- | --- | --- |
| Current native Codex session | Injected ceiling: **4 active agents total**, including root; **3 additional workers**. | Root plus `claude_audit`, `dispatch_audit`, `plan_audit` performed concurrent read-only audit work. All three delivered findings. No throughput benchmark. |
| Codex user configuration | `/home/claude/.codex/config.toml` sets no `agents.max_concurrent_threads_per_session` or legacy `agents.max_threads`. Official config reference defines the former as spawned threads **excluding** the primary. This does not override the current session's injected ceiling. | No capacity setting changed. The owner reports the earlier model-alias defect fixed; it is not an outstanding setup task. |
| Installed Claude Code 2.1.274 | Default **20 concurrent subagents**, plus one lead: **21 total**. `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` can override it. No override was found in the inspected shell/settings. Native descendants share their root's counter. | Binary/help inspection only; **zero Claude workers launched**. Runtime model availability, actual peak and throughput remain unmeasured. |
| Ordinary engineering workflow | One pending host request and one aggregate native result per stage; implementation, application, checks and final review have real dependencies. | Source traced; no application workflow launched for this audit. |
| Frozen G1 runner | Parallel candidate, repair and review arrays, with serial dependencies inside each candidate. Restricted native worker invocations. | Source inspection only. Not an ordinary-delivery concurrency mechanism. |
| Ruflo swarm records | Tracking/topology configuration; `maxAgents` is not the native executor's capacity. | Native audit delegation only. No swarm records were created and no tracked-swarm execution is claimed. |

Claude's installed executable is
`/home/claude/.local/share/claude/versions/2.1.274`, reached through
`/home/claude/.local/bin/claude`. Its embedded code contains:

```text
St=20;function sFr(){return a.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS??St}
```

The `Agent` guard compares that value with
`taskRegistry.getConcurrentSubagents()` (binary byte offset 203305054).
`takeConcurrencySlot()` increments `runningSubagents` and returns an idempotent
release callback that decrements it (198545898). Child tool contexts retain
`taskRegistry:e.taskRegistry` (197218918): nesting does not multiply capacity.
These are version-specific inspection anchors, not portable configuration APIs.
The guard has feature/model exceptions; 20 is the installed default, not a
universal provider ceiling.

Claude's native tool is `Agent`; `Task` is retained as a legacy name. The installed
Ruflo orchestration skills use the older name. Native depth defaults to 3 in
the binary, with feature/environment overrides; the installed nested-subagents
skill's depth-5 claim is not runtime evidence. Use flat delegation here.

`/home/claude/.claude/settings.json` enables experimental teams and selects
`opus`/`xhigh`; it does not set a numerical concurrency override. There are no
repository `.claude/settings.json`, `.claude/settings.local.json` or
`.claude/agents/` definitions. The user-level `diagrammer` definition is unrelated.
The explicit launch below supplies the approved route instead of inheriting a
potentially different alias/effort.

Codex reference inspected:
<https://learn.chatgpt.com/docs/config-file/config-reference#configtoml>.
Installed orchestration skills inspected: `ruflo-swarm/swarm-init`,
`ruflo-agent/nested-subagents`, and `ruvnet-brain`, under the user plugin caches.
Their worktree/CLI advice does not override this repository's main-only and
MCP-only instructions. Structured repository-memory searches produced no usable
phase-gating or documentation pattern; the live schemas cannot explicitly target
the separate user database, so cross-project recall was unavailable.

## Actual launch and delegation paths

1. [CLI](../../tools/engineering-harness/bin/oxigraph-delivery.mjs) accepts
   `workflow --spec FILE.json`.
2. [Workflow](../../tools/engineering-harness/src/workflow.mjs) validates the
   task, editable paths, commands and route. Live MCP control selects one
   `activeDeliveryTaskId` (or `activeHarnessTaskId`). `nativeStage` constructs
   a single `AgentPool` entry and asks the active coding host for a worker.
3. [Delivery routing](../../tools/engineering-harness/src/delivery.mjs) returns
   `planned-not-dispatched`. The host must actually dispatch native agents.
   Defaults restored in `7a460f6f`: Terra/medium implementation, Luna/low
   documentation, Sol/medium review, Sol/high difficult work, Astra/high
   decisions. Exact Claude overrides remain available.
4. [Host bridge](../../tools/engineering-harness/src/workflow-host.mjs) permits
   one outstanding request. `relayWorkflowHost` services mechanical MCP actions
   through real callbacks; it leaves native delegation and application to root.
5. One native Claude lead can fulfill that worker request using several native
   `Agent` children, then return **one** synthesized result. This is an operating
   pattern supported by the host contract, not a demonstrated cross-provider
   ordinary workflow in this audit.
6. Root applies the proposal, the controller runs checks in order, and a distinct
   native reviewer inspects the applied candidate and actual results. Exact MCP
   evidence readback precedes root's scoped commit/task completion.

The controller observes **whole-checkout** HEAD, tracked diff and untracked
source state. Concurrent editing workflows invalidate each other's observations,
even with disjoint files. Keep one workflow in flight; aggregate independent
work packages inside its bounded path inventory. Preserve a stable source state
through every read-only stage, check and final review. Commit after the workflow
returns, not during its source-bound stages.

The frozen path is different:

- [g12-programme.mjs](../../tools/engineering-harness/src/runtime/g12-programme.mjs)
  uses `Promise.all` for candidate plans, repair plans and reviewer providers
  (lines 522, 602, 666 at the inspected source).
- [upstream.mjs](../../tools/engineering-harness/src/runtime/upstream.mjs)
  orders architecture, critique, then implementation within a candidate.
- [native/codex.mjs](../../tools/engineering-harness/src/native/codex.mjs) and
  [providers.mjs](../../tools/engineering-harness/src/policy/providers.mjs)
  disable native multi-agent execution except the explicit Ultra path.
- [native/claude.mjs](../../tools/engineering-harness/src/native/claude.mjs)
  launches `claude --print --safe-mode --no-session-persistence
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' --tools '' ...`.
  That worker has no delegation tools. Do not weaken it to expose the 20 slots.
- Owner commit `f6b33199` removes `--ignore-user-config` from the frozen Codex
  invocation and its validator/diagnostic requirements. Preserve that correction.

The existing user helper
`/home/claude/.claude/model-router/bin/dual-host-deliberation.mjs` already runs
parallel native proposals and cross-critiques. It is unsuitable as this workflow's
dispatcher: Claude gets only `Read,Grep,Glob`, its model is not explicit, and
its deliberation/persistence contract differs from `ordinary-workflow-v2`.
Do not copy it into a second framework.

## Work breakdown and ownership

The following is the next application programme **after execution is requested**,
grounded in [ADR-0046](../adr/0046-shacl-12-editors-draft-realignment.md).
The September 19 handover is historical: `FOR`/`IN` removal is already complete
in `5df05873`; do not redo it. Existing DATA rejection messages already say the
specification issue is resolved.

All file ownership below means exclusive **proposal** ownership. Root alone
edits those files on `main`. New test filenames are planned deliverables.

| Work package | Exact proposed-file ownership | Dependencies and acceptance |
| --- | --- | --- |
| A1: DATA execution | `lib/oxshacl/src/srl/evaluate/native.rs` | Freeze ADR-0046's GD/GE contract first. Frozen GD includes base plus inline DATA (superseded 2026-09-23 by ADR-0047: base graph only); GE accumulates derivations. WHERE DATA remains sticky inside nested ordinary NOT; NOT DATA affects its own negation; ordinary rules see derivations; DATA flags select native evaluation. |
| A2: DATA admission | `lib/oxshacl/src/srl/evaluate/policy.rs` | Same contract as A1. Remove rejection only for implemented semantics. Apply atomically with A1; no acceptance-only intermediate commit. |
| A3: DATA regression | New `lib/oxshacl/tests/srl_data_semantics.rs`; existing `lib/oxshacl/src/srl/tests.rs` and `lib/oxshacl/tests/srl_query.rs` | Test design starts immediately; final proposal follows agreed public API/semantics. Independent fixtures distinguish frozen/working graphs, nested negation and data-only routing. Replace existing DATA-rejection assertions with the specified execution/query behavior; preserve unrelated IMPORTS rejection coverage. These are ordinary source tests, not pinned evidence. |
| C1: processor handling | `lib/oxshacl/src/sparql_rules.rs` | Confirm governing MUST clause and supported processor identity. Unknown `sh:ruleProcessor` fails closed; absence and supported values preserve specified behavior. Independent of A. |
| C2: processor regression | `lib/oxshacl/src/sparql_rules/tests.rs` | Agree C1's error/public contract first. Distinguish unknown, supported and absent processor values. Can remain with C1's worker if splitting adds handoff overhead. |
| B: body abbreviations | `lib/oxshacl/src/srl/evaluate/matching.rs`, `lib/oxshacl/src/srl/evaluate/policy.rs`, new `lib/oxshacl/tests/srl_body_abbreviations.rs`; narrowly reviewed behavior assertion in `lib/oxshacl/tests/srl_clause_inventory.rs` | Analysis may overlap A; actual proposals wait for A's accepted source and the test-contract review below. Collections, blank-node property lists, reifiers and annotations match explicit auxiliary-triple equivalents and preserve variable scope. Additional paths require an explicit ownership/spec revision before dispatch. |
| D: SPARQL inference layers | `lib/oxshacl/src/sparql_rules.rs`, `lib/oxshacl/src/sparql_rules/execution.rs`, `lib/oxshacl/src/sparql_rules/tests.rs` | Proposal waits for C's accepted source. Verify per-layer fixpoint semantics against the inference-rules document, keeping separate SPARQL-RL strata unchanged. Do not expand into the still-excluded repeated-firing/runOnce issue. |
| E: suite update | Inventory for `tools/shacl-tests/run.mjs`, `tools/shacl-tests/inventory.mjs`, `tools/shacl-tests/clause-audit.mjs`, `lib/oxshacl/examples/w3c_srl_rules_runner.rs`, `lib/oxshacl/src/profile/catalog.rs`; exact evidence paths established separately | Repin follows corrected A/B behavior and explicit evidence review. Check both renamed lanes, manifest name, six eval2 cases (not 19 files), counts and root reachability. Preserve historical pins until the exact replacement is authorized. |

The suite tooling in E is not currently admitted by the ordinary workflow's
product path inventory. Before that implementation, review the smallest adapter
and focused checks needed for those exact paths. Do not bypass the harness or
add arbitrary script execution. E is not a ready writer assignment.

B also encounters `blank_template_identity_and_body_policy_are_locked` in
`lib/oxshacl/tests/srl_clause_inventory.rs`: it currently requires a blank-node
body pattern to be unsupported. That file also contains pinned hashes, grammar
and manifest inventories. Review the exact behavior-contract change required by
ADR-0046 before dispatching B; preserve those pinned records. Do not silently
relax the assertion to obtain a pass or fold a suite repin into B. This is an
explicit dependency of B's final scope, not permission to refresh evidence.

### Workflow grouping and dependency readiness

Use one bounded first workflow for **A + C**, with the seven-file union A1-A3,
C1-C2. They are independent implementation branches sharing a stable baseline.
This obtains useful implementation overlap without concurrent workflow
controllers or conflicting `activeDeliveryTaskId` values. Checks and acceptance
remain explicit for both packages.

After that workflow is verified and committed, **B + D** can form a second
bounded workflow with their seven-file union if both are ready. Otherwise deliver
the ready package alone; do not wait solely to fill a batch. B owns `policy.rs`
only after A releases it; D owns the SPARQL files only after C releases them.
Never reuse a whole-file proposal prepared against the earlier baseline.

At most three delivery tasks may be active under
[ADR-0043](../adr/0043-delivery-recovery-and-proportional-release-boundary.md).
These work packages are subtasks, not a reason to create more active delivery
tasks. The next-wave and repin tasks stay queued while prerequisites remain open.

## Allocation, expansion and release

**Coordination:** Codex root owns task/control reads, the one workflow, source
identity, the ownership table, application, checks and commits. Claude lead owns
the proposal DAG, child dispatch, completion handling and synthesis. Codex
workers handle independent acceptance analysis and final review. Native tools,
not Ruflo records, execute the work.

| Stage | Claude allocation | Codex allocation | What releases work |
| --- | --- | --- | --- |
| Initial A+C request | Lead plus A contract/native proposal worker, A acceptance/test-design worker, C combined source/test worker: 3 additional agents. | Root plus one independent clause/acceptance analyst and, if useful, one B/D interface analyst. Keep the final reviewer unspawned until evidence is ready. | C confirms its processor contract and proceeds; A publishes the frozen GD/GE and callable interface contract. |
| Interface accepted | A1 native worker continues; dispatch A2 policy; A3 turns its design into test content. C continues or returns. Peak 4 children with combined C, at most 5 if C2 warrants separation. | Analysts return bounded findings; finished slots are available immediately. | A2 completion releases its worker for ready B/D analysis, not competing policy content. Do not retain idle workers. |
| Synthesis/application/checks | Lead reconciles the exact seven-file result; proposal children finish. Useful read-only next-wave acceptance preparation may continue on clearly identified source. | Root verifies ownership/lineage, applies once and runs ordered checks. | Passing checks release final review. Failure releases a targeted repair request, then fresh checks. |
| Final review | Original lead/children cannot review their own implementation. They may finish unrelated acceptance preparation. | Dispatch a fresh Sol/medium reviewer against the exact candidate and check evidence. Root services MCP handoff after acceptance. | ACCEPT plus exact evidence readback releases root's scoped commit. REJECT returns to repair. |
| Next wave | Fresh B and D proposals against the committed source, with exclusive paths and only ready subtasks. | Root starts the next existing workflow; independent review capacity shifts to the new candidate when ready. | A releases B's shared files; C releases D's shared files. E remains last and separately scoped. |

This deliberately uses fewer than 20 Claude children. The initial independent
questions justify three; later file ownership justifies four or five. There is
no demonstrated work for the other slots. Expand only when another bounded,
dependency-ready deliverable shortens the critical path. A tiny policy edit
does not need a long-lived worker. Never create a worker merely to occupy a slot.

Agent concurrency and build concurrency are separate. Initially allow **one
build/test command at a time**, dispatched by root through `run`/`workflow`.
No second Cargo process may replace a package's binary while tests re-execute
it. A separate target directory could address that race, but is not currently
an admitted ordinary command option and does not resolve shared-source or
resource contention; it is not a shortcut around the single build lane.

## Exact coordinating-session instructions

These commands are a runbook, not commands executed by this audit.

1. Confirm physical checkout `/home/claude/src/hm/oxigraph`, branch `main`,
   and current dirty state. Read AGENTS, ADR-0043 and ADR-0046. Retrieve live
   task/control through structured Ruflo MCP. Honor the owner's current hold.
   Do not create worktrees or alter protected runtime to manufacture readiness.
2. Prepare the existing JSON task spec under ignored
   `target/engineering-delivery/`, with actual live task ID, `scope: "product"`,
   the exact first-wave seven paths, and focused A/C checks followed by the
   applicable crate matrix. Example literal check argv:
   `["cargo","test","--locked","-p","oxshacl","--all-features","--test","srl_data_semantics"]`;
   the matrix includes `["cargo","test","--locked","-p","oxshacl","--all-features"]`.
   Review tests against the governing clauses before accepting them. Supply:

   ```json
   {
     "implement": {
       "model": "claude-opus-5",
       "effort": "high",
       "reason": "Native Claude lead combines independent bounded A and C proposals"
     },
     "review": {
       "model": "gpt-5.6-sol",
       "effort": "medium",
       "reason": "Independent review of the applied candidate and observed checks"
     }
   }
   ```

   This is a task-specific override, not a change to the restored model defaults.
   Preserve any more specific owner-requested exact model/effort instead.
3. Start the existing controller and keep its stdin open:

   ```sh
   node tools/engineering-harness/bin/oxigraph-delivery.mjs workflow \
     --spec target/engineering-delivery/task-spec.json
   ```

4. Service `mcp-read`/`mcp-handoff` with `relayWorkflowHost(request, callbacks)`
   from `src/workflow-host.mjs`, injecting the actual live `task_status`,
   `memory_retrieve`, `memory_store` tools. Inspect actual results; never echo
   expected values as readback. CLI alone has no MCP transport.
5. On `native-worker`, dispatch the exact route. For Claude use a native session
   with `Agent` available, not the frozen `--tools ''` adapter. Reuse
   `nativeChildEnvironment("claude")` from `src/native/environment.mjs` to
   preserve the configured subscription transport. This retains
   `CLAUDE_CONFIG_DIR`, `ANTHROPIC_BASE_URL` and the gateway credential in
   `ANTHROPIC_AUTH_TOKEN` for Claude only, as documented in the harness README.
   Provider API keys and OpenRouter remain prohibited. A launch
   template is given below. Supply the exact request, repository/personal
   instructions and ownership plan; safe mode disables automatic custom
   instruction/plugin loading. The Claude lead returns its actual identity
   and each child's identity, source identity, ownership and outcome.
6. In the Claude session inspect the live `Agent` schema. Use named, flat,
   read-only children; dispatch all ready assignments before waiting. The
   installed schema has `description` and `prompt`, optional `subagent_type`
   and `name`; `run_in_background` is context-dependent. Use background execution
   when exposed. Its `model` field accepts aliases, not arbitrary exact model
   IDs, and has no effort field. Use `subagent_type: "fork"` and omit `model`:
   the installed schema says forks inherit the parent's model. Verify actual
   effort in the first useful run; model inheritance does not establish effort
   inheritance. Never label an alias selection as proven exact execution.
   On each completion, inspect the deliverable, release its ownership/slot,
   and dispatch newly ready tasks. Wait for every assigned child and synthesize
   the accepted outputs before returning the final result. Keep a single queue;
   do not nest schedulers.
7. For Codex use the current native `collaboration.spawn_agent`,
   `send_message`, `followup_task`, `list_agents`, `wait_agent` tools. A routed
   fresh review uses `model: "gpt-5.6-sol"`, `reasoning_effort: "medium"`,
   `fork_turns: "none"` and a self-contained prompt containing source identity,
   paths, acceptance checks and real evidence references. At most three children
   can run alongside root here. Respect the live tool's slot accounting and
   reuse/release completed sessions as supported; a configured number is not a
   promise that a spawn succeeded.
8. Return one response matching the pending request's unchanged `schema`,
   `runId`, `requestId`, `taskId`, `specSha256`, `sourceSha256`, plus `result`.
   The result carries actual coordinator `client`, `workerId`, `model`, `effort`,
   `status`, `summary`, `verdict`, `findings`, `changes`. Full-file proposals
   must stay within 16 changes, 512 KiB per file and 1 MiB aggregate result.
   Keep child lineage in native observations/local evidence and reference it
   in the summary; do not add unrecognized result keys. Root checks **all**
   implementation identities against **all** review identities. The controller
   itself checks only aggregate IDs, so child independence is host-enforced.
9. Root alone answers `root-apply`, applying the exact proposed files. Let the
   controller run checks and request independent review. No edits or commits
   during checks/review. Review changes are `[]`. Retain local event/check
   files and their hashes. After successful MCP handoff, commit only this
   verified slice to `main`; then complete the live task. Do not push.

### Native Claude lead launch template

For an authorized request, prepare `lead-prompt.txt` under ignored
`target/engineering-delivery/` with the exact request and instructions above.
From the repository root, this uses the existing environment helper and native
CLI, not a new dispatcher. The exact requested model/effort are explicit:

```sh
node --input-type=module - <<'JS'
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { nativeChildEnvironment } from './tools/engineering-harness/src/native/environment.mjs';
const child = spawn('/home/claude/.local/bin/claude', [
  '--safe-mode', '--print', '--no-session-persistence',
  '--model', 'claude-opus-5', '--effort', 'high',
  '--permission-mode', 'dontAsk',
  '--tools', 'Read,Grep,Glob,Agent',
  '--allowedTools', 'Read,Grep,Glob,Agent',
  '--output-format', 'json'
], { cwd: process.cwd(), env: nativeChildEnvironment('claude'), stdio: ['pipe', 'inherit', 'inherit'] });
child.on('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
child.stdin.on('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
child.stdin.end(readFileSync('target/engineering-delivery/lead-prompt.txt'));
JS
```

Inspect the CLI's JSON envelope and actual native observations; its stdout is
not automatically a valid workflow response. Root constructs the matching host
response only after validation. The first useful run must confirm `Agent`
availability and inherited model/effort under this launch. Do not use `--bare`
(it disables native OAuth/keychain authentication), fallback models, API-key
transport, usage budgets or `--worktree`. On native subscription/model failure,
return `status: "unavailable"` with the exact client/model/effort and error.
The active Codex conversation does not prove authentication of a separate CLI.

Keep the native process handle while Codex continues independent assignments.
With `--output-format json`, report the Claude lead as active and child tasks
as assigned/pending confirmation until its result establishes actual execution.
For live native event reporting, use the installed
`--output-format stream-json --verbose` options instead and inspect the emitted
events; never infer running children from the assignment list alone. The minimal
tool allowlist supports one-shot child tasks and completion notifications. Add
the native `SendMessage` tool only when mid-task steering is needed.

## Reporting and acceptance of the operating pattern

Report at dispatch, completion, blocking events and integration boundaries:

```text
Source: HEAD + workflow sourceSha256; pending action/request ID
Active: provider / actual native ID / task / owned paths / model / effort
Ready: bounded deliverable / provider / dependencies satisfied
Blocked: deliverable / exact dependency or resource / releasing event
Review: candidate identity / checks complete / independent reviewer
Resources: writer=root; build lane=free|command; next application boundary
Unused capacity: slot count and concrete reason (no ready work, dependency, review wait)
```

Do not claim all slots are used from task rows alone. This audit's three Codex
workers completed useful findings; Claude capacity remains installed-code
evidence. During authorized useful execution record native start/end times,
peak overlap, completed accepted work packages, check outcomes, repair rounds,
and time waiting for interfaces, builds and review. Measure critical-path
elapsed time and completed verified work; claim a speedup only against a
comparable observed baseline. No provider-usage budget is introduced.

Remaining uncertainties are operational and bounded:

- The Claude launch's actual `Agent` surface and child model/effort must be
  confirmed in its first useful request. Static capacity evidence is stronger
  than a guess, but it is not a 20-worker execution demonstration.
- Cross-provider aggregation and child-lineage independence are host duties;
  this controller does not independently authenticate them. Keep real native
  observations and do not reuse implementers as final reviewers.
- A larger independent ready queue may justify more children. Increase fan-out
  only while useful task completion improves; native refusal is not permission
  to spawn extra root sessions to circumvent the limit.
- The suite update needs a separately scoped path adapter/evidence review.
  That known future gap does not justify changing today's bridge.

The smallest current repository change is this operating plan. No executable
configuration defect remains demonstrated for this fan-out pattern. Revisit the
bridge only if useful execution actually requires multiple outstanding requests;
that would require source/ownership semantics as well as request correlation,
not merely a larger numeric concurrency setting.
