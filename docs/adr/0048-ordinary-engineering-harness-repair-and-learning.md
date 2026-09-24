# ADR-0048: Repair ordinary engineering routing and evidence learning

- **Status**: Proposed
- **Date**: 2026-09-24
- **Updated**: 2026-09-24, after verified Semantic Builder delegation
- **Deciders**:
- **Tags**: metaharness, native-subscriptions, routing, frozen-evaluators, learning
- **Amends if accepted**: ADR-0017 and ADR-0043 ordinary engineering delivery only

## Context

Oxigraph is a Rust RDF/SPARQL database fork, not a software-repair benchmark.
Its workspace includes storage, query evaluation, parsers, RDF serializers,
RDFS/Datalog/OWL/SHACL, an HTTP CLI, Python and JavaScript bindings, and native
RocksDB integration. Linux x86_64 is the supported target under ADR-0045.
Correctness includes graph topology, versioned SPARQL semantics, transaction
atomicity, persistence/recovery, protocol behavior and pinned semantic profiles.
Native tests, W3C fixtures and explicitly admitted Jena/Souffle oracles decide
those claims; generated scores and engineering receipts do not.

This proposal records source inspection at canonical `main`,
`22e13f38d76dda89ba9a75ba5815577e5275eaed`, initially clean. Historical worktrees
exist; they are not implementation workspaces. Revalidate this observation before
execution. The September 23 handover contains later amendments to earlier pause
notes and remains historical evidence, not a current dispatch authorization.

### Existing implementation and concrete gaps

The `src/` paths in this table are relative to `tools/engineering-harness/`.

| Surface | Observed implementation | Repair boundary |
| --- | --- | --- |
| Ordinary delivery | `tools/engineering-harness/bin/oxigraph-delivery.mjs`; `workflow`, `run`, `route`; root applies native read-only proposals | Preserve this entry and sole integration writer |
| Upstream runtime | `src/workflow.mjs` imports `HarnessKernel`, `AlgorithmRouter`, `AgentPool`, `VerifierRegistry` | `nativeStage` creates a new pool per stage; retain one run-scoped pool |
| Ordinary routing | `src/delivery.mjs` selects explicit role defaults and reasoned overrides | Bind project policy to shared runtime routing; do not add a second Router |
| Frozen engineering lane | `src/routing/quality-router.mjs`, `src/runtime/native-pool.mjs`, native Codex/Claude adapters and versioned application receipts | Reuse reviewed mechanisms without activating old G1 tasks or rewriting their fingerprints |
| Ordinary evidence | Source checks, command observations, independent review, compact `ordinary-workflow-v2` references and live MCP readback | Consume shared runtime receipts and outcome reduction; retain local handoff bindings and honest isolation limits |
| Semantic qualification | Separate `tools/metaharness` Darwin adapter, pinned 41-command semantic inventory and mutation requirements | Keep separate; no `qualify`, synthetic qualification or G1.7 execution in ordinary repair |

The engineering npm lock records `metaharness` 0.4.8, harness 0.2.0, Router
0.4.0, Darwin 0.9.3 and AVO 0.1.4. Flywheel 0.1.10 is transitive. These are
observed resolutions, not claims about registry currency or integration.
The separate qualification package locks Darwin 0.9.3. Both packages support
Node >=20; the Rust workspace declares edition 2024 and Rust >=1.87.

`@metaharness/router` 0.4.0 predicts quality and exposes `costPerMTok`; it does
not expose an accepted-outcome latency selector. Darwin exports GEPA from
`@metaharness/darwin/gepa`, not an assumed root-level function. Factory packages
and generated scaffolds are not evidence that a repository task executed.

## Decision

Keep one thin project entrypoint and delegate execution to the existing/customised
shared `@metaharness/harness` runtime. The shared runtime owns Router selection,
escalation, API/native transports, workspaces, receipts, repair/review and
GEPA/evolution/learning. Oxigraph owns tasks, frozen evaluators, mutation and
ownership bindings, transport policy, and sole integration. Do not add a local
Router, retry state machine, workspace manager, receipt reducer, GEPA, Flywheel
or AgenticOW controller. Reuse the supported runtime facade; do not copy its
internals or transplant Builder's task corpus, product law or timeout exception.

Verified implementation reference: Semantic Builder `main` commit
`df74b4911cf05fa7ecdcdfe13c5e0d8533e97b12`, run
`run-2026-09-24T18-24-37-723Z-4f9af644`, receipt
`sha256:2f2c08d4008bd7100f152056b0172157ad034783a9a7fa3561e6110b87a6c8a2`.
That run is green and the lean entry delegates to its existing shared runtime.
This proves the Builder implementation, not an installed or accepted Oxigraph
adapter, live API execution, or portable cross-repository deployment.

This is an executable proposal for a later authorized repair session. Creating
or accepting this ADR does not resume product work, activate evolution, replace
semantic pins, authorize protected-state writes or authorize publication.
ADR-0043's direct-product-first and proportionality rules continue to govern.

### 1. Verify upstream contracts before changing design

The repair owner first records installed and committed package identities,
registry `dist-tags`, exact versions, tarball integrity, Node executable and
package export maps. Read actual declarations and implementation at that
resolution. Use `search_ruvnet` for source discovery and live Ruflo guidance for
reachable capabilities; neither is a substitute for installed API evidence.

Inspect the shared runtime's supported entrypoint, task/evaluator bindings,
transport policy, cancellation, result and receipt contracts first. Verify
actual delegation with injected transports and commands, including refusal,
repair and exact receipt provenance. Project code does not reconstruct the
upstream kernel, Router, pool, recovery or learning loop. If a required seam is
missing, return that bounded gap to the shared-runtime owner; do not create a
project-local substitute. Package presence alone proves no execution.

Use injected native/command doubles to prove import, callback invocation,
error/cancel propagation and receipt validation before any live worker. Keep
package manifests on their existing `latest` policy and commit exact lock
changes only in a justified dependency slice. Do not refresh the separate
semantic-qualification lock as collateral. Inspect lifecycle scripts; retain
the package `.npmrc` and `--ignore-scripts` boundary. New files stay under 500
lines and existing module seams own the change.

### 2. Preserve native transport and actual local model policy

The September 23 owner amendment admits one model-bearing process and one
build/test command at a time. Execute serially; independent review means a
separate fresh-context session after author completion. Keep one source writer
on canonical `main`; workers propose exact files and do no Git or test work.
No new branch, detached checkout or Git worktree is permitted.

Current native routes are Claude Code through configured 9router:

| Role | Exact model | Effort |
| --- | --- | --- |
| Coordinator and decisions | `cc/claude-opus-5` | `max` |
| Implementation and difficult repair | `cc/claude-opus-5` | `xhigh` |
| Documentation | `cc/claude-opus-5` | `low` |
| Independent review | `cc/claude-opus-5` | `high` |
| Build, tests, hashes and replay | No model | Deterministic |

Prospective API authoring uses only `deepseek/deepseek-v4.1-flash` through the
shared runtime's isolated OpenRouter adapter, followed by deterministic
verification and declared native subscription repair when needed. A verified
cheap candidate skips native authoring/repair, not required independent review.
API authoring and native repair/review are separate transports; frontier
subscription models never use OpenRouter. Current `AGENTS.md` forbids OpenRouter:
this lane remains disabled until explicit repository policy authorization and
the corresponding scoped configuration change. This Proposed ADR grants neither
that exception nor API spending authority. Do not activate Codex implicitly.
If later authorized, the API key reaches only the shared API adapter, never
native workers, generic tools or verifiers.

Existing reasoned Sonnet/Opus overrides remain governed by `routeDelivery`;
explicit Max selection still needs its recorded owner/unresolved basis.
Fable, Codex, unqualified aliases and Ultra remain inadmissible in ordinary
delivery. Preserve dormant native Codex/ChatGPT adapter and historical receipts
without dispatching or authenticating that host. Broader native Codex/Claude
portability is an adapter contract, not permission to restore mixed execution.
Only an explicit future owner change can alter the active host set.

Preserve `CLAUDE_CONFIG_DIR`, `ANTHROPIC_BASE_URL` and the configured gateway
`ANTHROPIC_AUTH_TOKEN` for the Claude child. Keep provider API keys, OpenRouter,
alternate transport and credentials out of generic command/verifier children.
Use literal argv, constrained paths and bounded/redacted diagnostic output.
Probe the selected native model through the admitted host path when live work
is authorized; login metadata alone is not readiness. On failure, pause with
exact native client, requested model/effort and error. Never substitute accounts,
providers, model aliases or direct API execution automatically.

Subscriptions have no monetary, token, request, invocation, seat or quota
budget. Upstream compatibility fields must be neutral and must not gate,
route, stop, retry or score work. Operational cancellation, output limits and
host safety controls remain distinct. Unknown usage or provider calls stay
unknown; native-client invocations are counted separately.

### 3. Route only within proven quality and capability boundaries

Supply project task/evaluator identity, declared native candidates, ownership
and transport restrictions to the shared runtime. It owns versioned route
identities, history, upstream Router invocation and escalation. Do not pool
efforts or transfer mixed-provider frozen-lane history into ordinary Claude
evidence, and do not implement parallel local selection or retry state.

Require shared routing to enforce host, role, read/write and capability
admission before selection. Retain configured incumbents for cold
start and label them uncalibrated. Deterministic all-required-verifier success
is the quality floor; a model completion or an upstream best-effort fallback
cannot satisfy it. Model-reported confidence never overrides application tests.

Once comparable evidence clears that floor, prefer lower observed time from
ready assignment to accepted integration, including context, failed attempts,
repair, review and verification. Consume shared model/tool/build/queue durations
separately; warm-cache and different evaluator results are not comparable speed
proof. Record ordinary observations without creating a model experiment
programme. Train only from explicitly eligible paired same-task evidence;
missing comparisons retain incumbents and cannot block delivery.

Keep a non-decreasing task capability floor across repair. Classify failure
before excluding a route: process interruption, missing artifact or dependency
is integrator preparation; verifier mutation is evaluator-owner work; exit 1
needs diagnosis before author blame. A confirmed authoring defect can exclude
its route and escalate to an admitted effort/model with a concrete reason.
Unavailable native models pause rather than becoming negative quality labels.

### 4. Freeze one evaluator and register one terminal outcome

Keep the live Ruflo task/control identity and ordinary workflow specification.
Extend that specification only where needed to bind baseline commit/tree,
evaluator commit and transitive content digest, exact read/write paths, new-file
admission, dependency/toolchain identities, deterministic commands, expected
failure signature, artifact outputs, review policy and named resources.

The verifier owner prepares a focused deterministic evaluator; root commits
that coherent slice first. Prove the pinned baseline fails for the intended
behavior after its build prerequisites pass. Register the task against that
prior evaluator commit: never self-reference the manifest commit. Reuse an
existing matching task; correct genuinely stale scope once before dispatch.
Do not turn each review finding or repair into a new task or evaluator epoch.

During an outcome, retain failed run/attempt records, add the smallest justified
regression, and continue the same task with explicit evaluator lineage. At the
final join, run the complete evaluator and declared review once on the exact
candidate. Repin reusable reconstruction evidence only after that join, if
needed; never refresh pinned semantic manifests to manufacture green results.

Exact non-Git snapshots may support evaluator isolation when authorized, but
do not replace the existing root-apply workflow or imply containment. Read-only
worker tools and boundary hashes cannot prove protection against hostile
same-UID or transient outside-tree reads. Label learning-ineligible runs
honestly until required read confinement is demonstrated.

### 5. Complete one lifecycle with immutable evidence

Retain the host bridge and its live `mcp-read`, `native-worker`, `root-apply`
and `mcp-handoff` bindings. Delegate execution, pool ownership, workspace
management, repair and review to the shared runtime. Do not create another
scheduler, MCP server or local lifecycle controller. Preserve fresh reviewer
identity/context and the project's sole integration writer.

The sequence is admission, intended-red baseline, admitted proposal, root apply,
candidate rebuild, focused/impacted deterministic verification, independent
review, repair if needed, final stable-source verification and exact MCP
readback. Review only a deterministically green candidate. No review from an
earlier patch carries forward after bytes change. Preserve all contributor
identities; no implementer or implementation analyst can review its own work.

Consume the shared runtime's immutable receipts, route outcomes and reduction;
do not recreate them locally. Bind local command/artifact/source evidence and
MCP handoff to those exact records. Require task/evaluator/policy/patch identity,
requested and observed transport/model, attempts, review, failure classification,
timestamps and final cleanup status. Missing or invalid receipts cannot accept
output. Distinguish kernel-chain validity, command success, owner review,
integration and product acceptance. Preserve failed records and historical
readers; never reconstruct missing evidence to make an old receipt valid.

### 6. Memory, GEPA, AVO and Flywheel are separate authorities

Use repository-bound structured Ruflo MCP for task state, ADR graph, outcomes
and learned project context. Retrieve exact keys after stores. Use the separate
`ruflo_user` connection only for reusable validated non-confidential lessons.
No CLI fallback, raw SQL, whole-database reads or database-sidecar manipulation.
Memory outages are recorded and do not block otherwise authorized delivery.

Engineering evolution and learning remain shared-runtime responsibilities,
including GEPA, Flywheel and any admitted AVO/AgenticOW use. Oxigraph supplies
authorized task evidence and direct frozen evaluators, not another evolution
controller, corpus scheduler or promotion loop. No local wrapper directly
launches GEPA or replaces shared promotion/replay decisions.

Any later authorized epoch must retain frozen model/route/evaluator identities,
sealed holdouts, opaque reflection IDs, direct correctness checks, clean replay
and separate promotion authority. Diagnostic or null results do not promote.
No benchmark sweep is a prerequisite to ordinary delivery. Stock SWE-bench or
generic sandbox scores prove no Oxigraph semantics. Engineering, semantic
qualification and Ruflo retrieval learning remain separate; this ADR activates
none of them and authorizes no daemon or automatic policy promotion.

## Staged implementation and validation

1. Re-read `AGENTS.md`, ADR-0017, ADR-0043, latest handover and live owner control.
   Verify physical path, `main`, HEAD, dirty paths, owner and process inventory.
   Preserve unrelated work and protected runtime state. Confirm one active
   model process and one build/test command; a document is not a resume order.
2. Verify the cited Builder implementation and supported shared-runtime facade.
   Freeze adapter tests for real delegation, project bindings, transport refusal,
   receipt provenance and lifecycle failure propagation. Commit evaluators first.
3. Converge the existing entry onto that facade through the existing harness,
   one verified slice at a time. Keep historical readers byte-compatible and
   local ownership intact. Missing shared seams go to the shared-runtime owner.
   Do not duplicate routing, escalation, workspaces, receipts or evolution.
4. Validate with injected workers first, then one explicitly authorized real
   ordinary outcome. Record actual native identity and separate simulated proof.
   The chosen task must exercise observable Oxigraph behavior or a demonstrated
   harness defect; do not invent a benchmark programme to populate metrics.
5. Commit only reviewed, scoped changes on `main`. Hand back exact receipts and
   unresolved gaps. Evolution activation and publication remain separate work.

Existing focused test recipe, executed serially by the authorized Claude
coordinator after replacing the live task ID:

```sh
node tools/engineering-harness/bin/oxigraph-delivery.mjs run \
  --task task-REPLACE-WITH-LIVE-ID --check "Delivery contracts pass" -- \
  node --test --test-reporter=tap \
  tools/engineering-harness/test/workflow.test.mjs \
  tools/engineering-harness/test/delivery.test.mjs \
  tools/engineering-harness/test/astra-routing.test.mjs \
  tools/agentic-qe/process-runner.test.mjs
```

Repeat relevant changed JavaScript contracts under the supported Node and Node
20 through the same entry, after inspecting executable selection and admission.
Build changed ordinary modules and affected Rust targets before commit. Run
default/all-features tests and applicable default/all/no-default Clippy; select
actual crate scope. Use read-only formatting checks and required one-minute
fuzz targets for changed listed crates. Serialize all Cargo commands: crash
tests re-execute their own binary, so concurrent rebuilds can cause false
failures. Never invoke broad `npm test` blindly: G1.7 tests share that inventory.

## Acceptance criteria

- Thin entry delegates to the existing/customised shared runtime; injected
  evidence proves execution ownership, not decorative imports. No duplicate
  Router, retry, workspace, receipt or evolution controller remains active.
- Intended-red evaluator, rebuilt candidate and independent green-candidate
  review bind identical source/evaluator identities; out-of-scope edits fail.
- Native Claude/serial policy holds. OpenRouter remains refused until explicit
  repository authorization; prospective tests prove isolated DeepSeek authoring,
  verified-success short-circuit and declared native repair/review. No secret
  reaches prompts, logs, generic children or receipts; silent fallback fails.
- Model/effort identity, cold start, capability floors and failure attribution
  are explicit. Faster selection requires comparable quality-cleared evidence.
- Failure, cancellation, drift, duplicate delta, interrupted finalization and
  replay tests pass; successful handoff includes root integration evidence.
- Frozen semantic/G1 receipts, protected state and qualifier behavior remain
  unchanged. No qualification, product completion or promoted learning is
  claimed from engineering metadata.

## Rollback and session handoff

Rollback uses a scoped main revert of the faulty new slice after preserving
evidence and user work; never reset, erase receipts or refresh baselines.
Restore the last validated ordinary policy/lock and retain readers for new
diagnostic records. Stop new admission if integrity fails; keep product data,
RocksDB stores, G1 state and semantic oracles untouched. Policy rollback is not
permission to launch a disabled host or reactivate paused work.

Hand off repository/branch/head, exact changed paths, task/control keys,
baseline/evaluator/lock/route digests, native session/model/effort, every command
and exit, candidate patch, failed and accepted receipt locations, source-stable
review result, accepted commit, memory readbacks, resource observations and the
next ready step. List unexecuted live/promotion gates explicitly.

This ADR was authored from source and declarations, without builds, native
workers, qualification or runtime-state mutation. User-memory semantic search
returned `Mcp error: -32603: Failed to execute MCP tool 'memory_search':
policy-state-lock-timeout`; exact-key retrieval succeeded for the superseded
phase-gating pattern, its full-operational-harness successor and Flywheel rule.
The available project MCP connection belongs to Semantic Builder. Register
`mem:ADR-0048`, related edges and `adr-patterns/ADR-0048` only through a verified
Oxigraph project connection; cross-project memory pollution is not permitted.

## Consequences

### Positive

- Ordinary work gains explicit routing, failure attribution and reusable
  evidence without reintroducing containment qualification as a delivery gate.
- Native transport and domain evaluators remain authoritative and inspectable.

### Negative

- Thin adapter compatibility and project bindings require maintenance tests.
- Serial, fresh-context review adds time; missing paired evidence limits speed
  claims and leaves configured incumbents in place.

### Neutral

- Historical qualification and dormant Codex capability stay readable.
- This proposal supplies no release, activation, publication or push authority.

## Links

- [Repository evolution harness](0017-repository-evolution-and-evidence-promotion-harness.md)
- [Proportional delivery](0043-delivery-recovery-and-proportional-release-boundary.md)
- [Semantic qualification](0004-metaharness-darwin-qualification.md)
- [Engineering entry and contracts](../../tools/engineering-harness/README.md)
- [Latest programme handover](../handover/2026-09-23-claude-programme-handover.md)
- [Semantic Builder reference](../../../semantic-builder/docs/adr/ADR-0051-upstream-metaharness-application-delivery.md)
- RuvNet Brain retrieval ID 17db89132957 (2026-09-24):
  `metaharness/packages/harness/README.md` and `packages/harness/package.json`.
  Retrieved snapshots are discovery evidence, not live-version or activation proof.
