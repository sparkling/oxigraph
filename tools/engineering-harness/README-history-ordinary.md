> Historical README excerpt; ordinary-policy instructions are superseded by [current guide](README.md).
> Frozen obligations and dated evidence retain their original scope. No new execution authority.

# Oxigraph engineering harness

This private package is the application-development control plane accepted by
ADR-0017. It is separate from `tools/metaharness`, which remains the immutable
semantic-qualification adapter.

The package requests current upstream `latest` dist-tags. Its committed npm
lock binds exact registry tarballs and SHA-512 integrity, and `.npmrc` disables
lifecycle scripts. Runtime publication and OpenRouter transport are forbidden.

## Configured subscription transport

Ordinary programme delivery uses native Claude Code through the user's
Claude subscription in 9router (owner, 2026-09-22). Exact model IDs carry the
`cc/` prefix; Codex is not an ordinary delivery route. Claude children preserve `CLAUDE_CONFIG_DIR`,
`ANTHROPIC_BASE_URL` and the gateway credential in `ANTHROPIC_AUTH_TOKEN`.
Model and tool restrictions still come from the harness. Provider API keys
and OpenRouter remain prohibited; the generic tool environment stays scrubbed.

## Ordinary delivery: use for every programme build and test

The mandatory everyday entry point is
`node tools/engineering-harness/bin/oxigraph-delivery.mjs`, run from canonical
`main`. Use `workflow --spec FILE.json` for a bounded implementation/repair
task. Its controller connects the steps below; the active native Claude host
executes its tool requests. This is not a replacement coding agent platform.

MetaHarness kernel stages invoke native implementation and review workers.
The existing `run` subcommand supervises deterministic build/test commands
using the shared Agentic-QE process helper. Neither path starts the frozen G1
candidate runner or semantic qualifier. No new dependency or product runtime
requirement is introduced.

### Integrated task workflow

```sh
node tools/engineering-harness/bin/oxigraph-delivery.mjs workflow --spec target/engineering-delivery/task-spec.json
```

The task specification is ordinary local input, not an authority token. For
example, replace the task ID, goal and check with the current approved task:

```json
{
  "schema": 1,
  "taskId": "task-REPLACE-WITH-LIVE-ID",
  "scope": "harness",
  "goal": "Repair the declared host adapter defect",
  "completionCheck": "The regression passes and independent review accepts the exact repair",
  "paths": ["tools/engineering-harness/src/workflow-host.mjs"],
  "checks": [{
    "completionCheck": "Host and delivery regression tests pass",
    "argv": ["node", "--test", "--test-reporter=tap", "tools/engineering-harness/test/workflow.test.mjs", "tools/engineering-harness/test/delivery.test.mjs"]
  }]
}
```

The controller orders the work:

1. Live MCP task/control read and owner-hold check.
2. Native read-only implementation proposal, then root-only application of the
   exact file contents; other preexisting changes must remain untouched.
3. Deterministic checks through `run`. A failure stops later checks/review and
   feeds the failure identity and local log paths into repair.
4. Independent native review of the resulting files and actual checks. A
   rejection feeds findings into repair, followed by new checks and review.
5. Live MCP evidence store and exact readback. Only then does the controller
   return `ready-for-owner-review`. Root owns scoped commits, live task
   completion and any separately authorized publication.

The host bridge emits a short JSON line with a `request-N.json` path. Read that
exact request and execute its action using real tools:

| Action | Native host responsibility | Returned `result` |
| --- | --- | --- |
| `mcp-read` | Live Ruflo `task_status` and control `memory_retrieve` | `{ "task": <actual task>, "control": <actual control value> }` |
| `native-worker` | Dispatch the requested model/effort through native agent tools; link actual identity through MCP; no worker writes or tests | Structured native result described below |
| `root-apply` | Root applies the exact proposed contents using `apply_patch` | `{ "writer": "root", "applied": true }`, only after checking application |
| `mcp-handoff` | Store the requested evidence through Ruflo MCP, retrieve it and inspect equality | `{ "value": <actual retrieved value> }`, never an echoed substitute |

For the mechanical actions, use `relayWorkflowHost(request, callbacks)` from
`src/workflow-host.mjs` inside the native host's tool turn. Supply real
`taskStatus`, `memoryRetrieve` and `memoryStore` callbacks from the live MCP
registry. The dependency-free function can be serialized into a host tool
isolate; it does not create an MCP client or launch Ruflo through a shell.
Service consecutive mechanical requests in the same bounded tool turn instead
of asking a model to relay each JSON value. Task/control reads are fresh and
concurrent; no cached control can suppress a new owner hold. Store must report
success, followed by a fresh exact readback. Async-generator callbacks can yield
observations without completing or abandoning their pending action.
`native-worker` and `root-apply` are returned unchanged for the accountable host
to execute. Hosts that directly embed the stdio bridge can inject the same
callbacks as its fourth argument. The CLI alone still has no MCP transport.

Return one JSON line to stdin containing the request's unchanged `schema`,
`runId`, `requestId`, `taskId`, `specSha256`, `sourceSha256`, plus `result`.
Do not copy `action` or `payload` into the response. A native result contains
`status: "completed"`, actual `client`, `workerId`, `model`, `effort`, `summary`,
`verdict` (`ACCEPT`, `REJECT` or `INCONCLUSIVE`), `findings` and `changes`.
Implementation changes are `{path, content}` full UTF-8 files; review changes
must be `[]`, and its worker ID must differ from every implementing worker.
For unavailability return `status: "unavailable"` with exact client, requested
model/effort and `error`; the controller stops without substituting a model.

### Evidence write-up helpers

Most rejected reviews in the 2026-09-22/23 sessions were about the write-up,
not the code: an unreceipted figure, a receipt taken on a dirty tree, or
wording that went stale on the next commit. Two helpers catch these before
review. Neither is a model call or a substitute for the independent review.

```sh
# Evidence table rows generated from receipts, each with its own head and
# whether its tracked diff was empty. Dirty receipts are flagged.
node tools/evidence/receipt-evidence.mjs run-XXXXXX run-YYYYYY

# Pre-review check: missing or dirty receipts and "this commit" wording are
# errors; unknown hashes are warnings (they may be session IDs or upstream
# commits, which --allow-commit accepts).
node tools/evidence/adr-prereview.mjs [--allow-commit HASH] docs/adr/00NN-*.md
```

Review order: run both helpers first and fix what they report. Then send the
independent reviewer the code, receipts and the helper output, and ask it to
focus on correctness. That keeps review rounds for defects a script cannot find.
One review runs at a time.

Their tests run through the delivery entry point:

```sh
node tools/engineering-harness/bin/oxigraph-delivery.mjs run --task <live-ruflo-task-id> --check "Evidence helpers pass" -- node --test --test-reporter=tap tools/evidence/receipt-evidence.test.mjs tools/evidence/adr-prereview.test.mjs
```

### Native serial execution

The owner-set maximum parallelism is 1 (see `AGENTS.md`). Run one model-bearing
process and one build or test at a time. Each `native-worker` request therefore
represents exactly one implementation worker or one independent reviewer.
Implementation and review prompts explicitly forbid subagents, contributors,
child sessions and independent native sessions.

Serial-policy regression coverage is executed by
`test/workflow-policy.test.mjs`. Shared setup lives in
`test/support/ordinary-workflow-fixture.mjs` and is imported support, not a
direct `node --test` target.

The programme coordinator uses native Claude Code `cc/claude-opus-5` / `max`,
following the owner's 2026-09-22 Claude-only restoration and 2026-09-23 Opus
selection. Root services the workflow bridge and applies reviewed proposals. At
the next authorized programme start, record the actual Claude session ID in the
live `programmeCoordinator` field; never relabel a historical Codex session.
Worker and reviewer defaults remain task-specific. No additional scheduler or
delivery role is needed.

For compatibility, a native result may omit `contributors` or return an empty
array. Any non-empty value fails before application for implementation results
and before handoff for review results. Historical evidence remains unchanged.

The controller accumulates the one aggregate implementation ID from each repair
attempt. It supplies `implementationWorkerIds` to review and rejects a reviewer
whose ID appears in that set. Full attribution remains in content-bound events
for every attempt, including rejected and repaired candidates. Identities and
client/provider attribution remain host-supplied and inspected, not independently
authenticated.

Keep one source-stable workflow, one root writer and one build lane. Role defaults
are starting policies, not measured speed/token rankings; use explicit overrides
for difficult work, bounded context and independent evidence-derived review.
Record actual native usage when available without quotas or billing estimates.

Keep the host process attached while answering requests. Pipes are preferred;
a dedicated PTY must disable echo and canonical line buffering before launch
because full-file JSON responses exceed terminal line limits. EOF, malformed
responses, stream failures or a 30-minute pending host action stop the run.
This is a tool-turnaround timeout, not a subscription usage budget.

Optional `implement` and `review` objects accept `model`, `effort`, `reason`
and `selection` under the policy below. Scope `product` requires the active
delivery task and no owner hold; scope `harness` requires the active harness
task and admits only ordinary Node checks. Editable paths are explicit and
restricted by `validateWorkflow`; protected state is not in either inventory.
Unsupported files/commands require a reviewed adapter, not a bypass.

The product inventory includes the specifically reviewed native lock adapter
`oxrocksdb-sys/api/c.cc`; it does not admit sibling headers or vendored native
sources. This exception supports ordinary ADR-0028 implementation/repair only.

Root and declared crate `Cargo.toml`/`Cargo.lock` files are admitted source
inputs, including the root `cli` and `testsuite` manifests. This does not admit
arbitrary `--manifest-path` command overrides. New nested source files may have
missing parents; preflight checks their nearest existing canonical parent and
still rejects symlinks, traversal and nonregular inputs. CLI specification and
source preflight run before allocating a workflow directory or dispatching a
worker. Adding paths never grants publication or dependency-upgrade authority.

Output lives in ignored `target/engineering-delivery/workflow-*/`: exact host
requests, completed stage/check events and a final result or failure. These
records do not implement crash-resume. A fresh controller requires fresh
source/control observations; it must not reuse old responses as a new run.
An unchanged repeated source/failure stops for integrator judgment. No-op
proposals cannot complete the task. Raw command output stays local; workers
receive bounded feedback with evidence identities and inspectable log paths.

New results use `ordinary-workflow-v2`: compact check/review summaries reference
the full local event and command records by canonical path and SHA-256. The
controller checks their content and rechecks the references at handoff. It does
not recursively copy full event history into the final result or MCP evidence.
Keep those local files to inspect a result; a missing or changed reference is
not repaired by regenerating evidence. Historical v1 records remain unchanged.

**Demonstrated boundary (2026-09-10):** a real Terra Medium worker proposed the
host input-stream repair, root applied it, `run-WszUBB` passed 27 tests, a
distinct Terra Medium worker accepted it, and live MCP read back the exact
evidence. Workflow `225a84f0-3269-4246-8782-938b2fd5cfaa` is recorded under
`programme-task-evidence/workflow-225a84f0-3269-4246-8782-938b2fd5cfaa` and
`target/engineering-delivery/workflow-6K0Pix/`. Earlier failing attempts remain
intact. Repair-feedback and rejection paths also have deterministic fixtures;
those test doubles are not claimed as additional native executions.

The controller enforces transition and source checks, but trusts inspected
host-supplied native identities and MCP values. A receipt is not independent
authentication. One writer and boundary comparisons are not a filesystem
sandbox or protection against transient concurrent edits. There is no
unattended host dispatcher, automatic commit/push, product qualification or
durable crash recovery. Harness evolution is separate and remains inactive.

### Deterministic command runner

```sh
node tools/engineering-harness/bin/oxigraph-delivery.mjs run --task <live-ruflo-task-id> --check "Store integration tests pass" -- cargo test --locked -p oxigraph --test store
node tools/engineering-harness/bin/oxigraph-delivery.mjs run --task <live-ruflo-task-id> --check "CLI builds and Cargo identifies its artifact" --artifact target/release/oxigraph -- cargo build --locked --release -p oxigraph-cli
node tools/engineering-harness/bin/oxigraph-delivery.mjs route --task <live-ruflo-task-id> --role implement --check "observable native completion check"
```

For standalone diagnostic/build invocations, the native coordinator owns this
lifecycle. Within `workflow`, the controller requests these transitions:

1. Retrieve the live task and programme control through structured Ruflo MCP;
   honor an owner-review hold before any product work. Define one completion check.
2. Use `route` for each model-assisted subtask. It emits an explicit native
   dispatch (`provider`, model, effort), not a dispatched worker. Use the native agent tools to execute;
   link the actual native ID/model/effort to Ruflo through MCP. Keep one writer.
3. Run **all** programme build/test commands through `run`, including repairs
   and reviewer-requested checks. Cargo build/check/clippy/test and the explicit
   ordinary Node test inventory are admitted. Cargo test accepts `--ignored`
   after its `--` separator for explicitly selected tests; unsupported libtest
   flags remain rejected. Non-writing `cargo fmt --all`
   (or `-p PACKAGE`) followed by `-- --check` is also admitted, as is the exact
   AGENTS one-minute command `cargo fuzz run TARGET --sanitizer none --
   -max_total_time=60` for its listed targets. Fuzz success requires startup and
   positive terminal execution evidence from the bounded complete process
   capture, not exit zero or a retained tail alone. Unregistered commands require a
   small reviewed adapter and tests before use, not a direct-shell bypass.
4. Inspect `target/engineering-delivery/run-*/result.json` and logs. It records
   the task ID, completion-check plan/hash, literal argv, Node/native versions,
   HEAD, tracked diff and
   untracked-file hashes, before/after source identity, actual exit and test
   summaries. A selected build artifact requires a matching Cargo
   `compiler-artifact` event and records exact bytes, SHA-256 and Cargo's
   cached/fresh indicator.
   Nonzero exits, timeouts, output overflow, source drift, and missing/zero
   test observations fail; a cached Cargo build is not called a fresh rebuild.
5. Review the actual result, update the live Ruflo task and concise evidence
   memory, and read back that exact value. Only then hand off the verified slice.

The `run` subcommand has no Ruflo CLI/database fallback and no model transport.
Its successful status is `command-passed`, never completed delivery. Task
attribution stays explicitly coordinator-supplied and unverified in the local
observation; the MCP readback is separate, performed by the native coordinator.
Its task ID is coordinator-supplied, **not independently MCP-verified**; the
coordinator must perform step 1 and step 5. An observation is not a signed
qualification receipt, completed product task, or publication authorization.
Source stability detects changes at the boundaries; it is not a filesystem
sandbox or hostile-concurrency guarantee. Shell access is not globally
intercepted: this is the required programme execution path, not an OS-wide ban.
Legacy build instructions remain recipes to pass through this entry point.

Model roles are executable policy in `src/delivery.mjs`: no model for build/test;
`cc/claude-opus-5` / `xhigh` for implementation, Opus / `low` for documentation,
Opus / `high` for review, Opus / `xhigh` for difficult work, and Opus / `max`
for decisions and programme coordination. The owner replaced Fable with Opus on
2026-09-23; `cc/claude-fable-5-1` is no longer admitted. The `cc/` prefix selects the owner's 9router Claude subscription.
Exact `cc/claude-sonnet-5` and `cc/claude-opus-5`
overrides support `low` through `max`; explicit overrides need a reason and
completion check. Explicit Max overrides also require `--selection owner` or
`--selection unresolved`; the default decision/Max route needs no override.
Codex, unqualified model IDs, aliases, effort-less Haiku and Ultra are rejected,
including in contributor records. Every model route emits
`nativeDispatch.provider: "claude"`. Unavailability stops with exact client,
model and error, without substitution. Historical records retain their original
identities; frozen qualification adapters are not activated by this policy.
See the [current launch instructions](../../docs/plans/native-agent-strategy-reassessment.md#configured-9router-launch)
for forwarding gateway settings when using Claude's `--safe-mode`.
These are starting policies, not proven speed or token winners. Bounded task
packets state why a stronger route is needed. Efficiency evidence from ordinary
work includes necessary context, review, failed attempts and repair; missing
usage stays unknown. No separate model experiment programme is required.
Ruflo's Claude-only model-outcome enum cannot truthfully record Codex outcomes:
store the actual native model and result in repository memory, without
training under a false model name or claiming measured savings.

Focused self-checks (use the supported Node executable, then Node 20):

```sh
node tools/engineering-harness/bin/oxigraph-delivery.mjs run --task <live-ruflo-task-id> --check "Delivery workflow, routing and process contracts pass" -- node --test --test-reporter=tap tools/engineering-harness/test/workflow.test.mjs tools/engineering-harness/test/delivery.test.mjs tools/engineering-harness/test/astra-routing.test.mjs tools/agentic-qe/process-runner.test.mjs
```
