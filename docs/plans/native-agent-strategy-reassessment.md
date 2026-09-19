# Native-agent strategy: speed, token efficiency and accuracy

Started: 2026-09-19. Updated: 2026-09-20. Source: `2d23f875`, canonical `main`.
Status: completed swarm discussion, operating plan and contributor-contract
update. Application execution remains paused; routing defaults are unchanged.

This incorporates both owner amendments: independent Codex sessions (`c63b1fef`)
and independent Claude sessions (`2d23f875`). It supersedes the recommendations in
[the earlier parallel-execution plan](native-agent-parallel-execution-plan.md).
Its source inspection remains useful evidence. The design below starts from
work dependencies and acceptance, without assuming Codex sessions are scarce.

## Conclusion

Use a flat group of native workers selected for bounded tasks, one accountable
proposal synthesizer, and the existing engineering workflow. Choose a provider
for the task and its observed performance, not its advertised agent count.
Add a dedicated delegation lead only when coordination actually benefits from it.

Require the same correctness checks for every route. Then improve elapsed time
to accepted work and total attributable token use, including coordination,
repairs and review. There is no measured universally optimal model mix here.

The first useful allocation is A semantics/policy, independent A oracle/fixtures,
and C processor handling/tests. The oracle worker derives its cases from clauses
before seeing implementation rationale; a duplicate clause-analysis worker is
unnecessary. Future ready work can use further
independent native sessions without imposing a repository-wide session cap.

## What changed, and what did not

The owner's [AGENTS amendment](../../AGENTS.md) records four concurrent
independent `codex exec` sessions completing on Codex 0.155.1. We therefore
discard the earlier inference that this conversation's three child slots make
Codex globally scarce. The subsequent amendment makes the same independent-session
rule explicit for Claude. No account-wide cap is assumed for either provider,
and no repository override of native subagent counts is added.
Four successful sessions are not a measurement of infinite runtime capacity.
Codex is the native client using the ChatGPT subscription; those names are not
two independently measured provider pools.

| Constraint | Effect on this design |
| --- | --- |
| This conversation allows four active native agents including root | A local tool constraint; additional independent native sessions are a separate supported execution path. Do not change or misrepresent the tool's limit. |
| Claude 2.1.274 defaults to 20 additional children per root | A per-session capability, not a repository-wide limit or reason to mandate a Claude lead. Independent Claude sessions are also available; their concurrent capacity has not been benchmarked. |
| One writer on canonical `main`; no feature branches/worktrees | Every worker returns read-only proposals; root applies. More model sessions do not create more writer authority. |
| Whole-checkout source identity; one outstanding host request | One workflow in flight, stable source during proposal/check/review stages, one aggregate result. |
| One selected live delivery task; at most three active delivery tasks | Work packages can be parallel subtasks inside a bounded workflow. Session count is not delivery-task count. |
| Shared Cargo outputs and self-reexecuting tests | Root dispatches one competing build/test command at a time. Agent and build concurrency remain separate. |
| Native subscriptions and exact requested models | Preserve configured transports and owner model selections; report exact native unavailability rather than substituting. |
| Pinned evidence and existing authority boundaries | No silent repin, qualification, publication, protected-state cleanup or application start. |

Every future application implementation, repair, review, build and test still
goes through `tools/engineering-harness/bin/oxigraph-delivery.mjs`.

## The swarm discussion

Ruflo swarm: `swarm-1789853781037-187f5y`.
Research task: `task-1789853879500-6mdds1`.
Topology: hierarchical tracking, four discussion roles. That tracking size is
not a provider limit. Native Codex tools executed the discussion; MCP registered
and tracked it. No Ruflo provider-API executor was used.

| Native participant | Question and delivered result |
| --- | --- |
| `/root/dispatch_audit` | Compared native children, independent roots and a dedicated lead; proposed a flat allocation and critical-path dispatch. |
| `/root/plan_audit` | Proposed task-specific model/effort starting routes, escalation and token-efficient context handling. |
| `/root/claude_audit` | Challenged both proposals on acceptance independence, measurement attribution and confounded model comparisons. |
| `/root` | Inspected current routing/transport constraints, reconciled the debate and owns this document. |

The three specialists used existing native Astra sessions for this architecture
review. That is not the proposed model mix for routine delivery, nor a comparison
of Codex with Claude. No Claude model session or application workflow was
launched in this discussion.

The topology and model advocates exchanged proposals. The skeptic then
challenged their agreement; both advocates answered the objections:

| Question | Argument | Counterargument | Resolution |
| --- | --- | --- | --- |
| Always put Claude in charge? | Native child messaging and broad fan-out can simplify coordination. | Independent Codex roots remove the slot-scarcity premise; a permanent lead adds context and another serial synthesis step. | Start flat. Use a lead when repeated coordination demonstrably helps the actual graph. |
| One worker per file? | Exclusive paths make parallel proposals easy to track. | A's tiny policy removal is coupled to its evaluator; separating it adds handoffs with little independent work. | Group coupled changes by deliverable, not file count. Keep path ownership explicit. |
| Split A implementation from tests? | Independent fixtures can expose the same semantic mistake before integration. | Both workers may reconstruct the same difficult model or wait on a changing interface. | Derive the acceptance oracle first. Split fixtures when public interfaces are stable; otherwise transfer fixture ownership to the implementer while preserving independent oracle/final review. |
| More models means more accuracy? | Different models may expose different failure modes. | Different sessions can share the same wrong premise. Majority voting cannot decide specification truth. | Derive expected behavior from governing evidence before reading implementation rationale; use targeted additional review for a named unresolved invariant. |
| Use the smallest model first for everything? | Smaller routes may be quicker and use less context. | Extra attempts, explanation and repairs may cost more tokens and time than a stronger first attempt. | Start difficult work at the difficult tier. Compare the whole accepted result, not individual calls. |
| Combine speed/tokens/accuracy into one score? | A scalar would simplify selection. | We lack calibrated tradeoff weights, and correctness must not be traded away. | Keep acceptance fixed; compare elapsed time and tokens separately, reporting genuine tradeoffs. |

Tracking caveat: `agent_spawn` returned a `sonnet` routing tier despite an exact
`gpt-6-astra` request. The tracked configs record the native identity correction;
the registry's model/provider fields are not evidence of the executed model.
Do not use those fields for model-performance statistics. Native execution
identity and observed results remain authoritative.

### Second swarm: changes after both capacity amendments

At the owner's request, a fresh swarm reviewed the first proposal against the
remaining work: `swarm-1789854848137-hgwyk1`, task
`task-1789854944008-dzf0h5`.

| Native participant | Exact route | Delivered improvement |
| --- | --- | --- |
| `/root/capacity_free_allocation` | `gpt-5.6-sol` / `high` | Organize source states and readiness waves; combine duplicate oracle work; identify useful wider backlog preparation. |
| `/root/capacity_free_models` | `gpt-6-astra` / `high` | Challenge blanket frontier use and compulsory strong-model preflight; select by unresolved uncertainty and consequence. |
| `/root/capacity_free_contract` | `gpt-5.6-sol` / `medium` | Bind contributions to their source state, require route rationale and preserve attempt-level event evidence. |

The specialists exchanged proposals and objections. Allocation initially proposed
a dedicated strong-model contract preflight; the model specialist rejected it
where ADR-0046 already supplies the contract. The resulting rule is a quick
triage within existing work, not a new serial phase. Use Astra/high upfront
only when a named ambiguity or invariant warrants it; fan-out alone is not a
reason to increase model size.

The second review also removed the redundant fourth clause analyst, retained
native roots for exact heterogeneous model/effort selection, and made incremental
proposal reconciliation part of synthesis. Claude independent-session capacity
remains unbenchmarked; neither provider gets a fixed repository-wide cap or a
native-subagent override. The swarm used three actual native worker sessions
with the routes above; it did not benchmark provider throughput.

## Dispatch policy

Root maintains the ready queue, dependency graph, source identity, ownership and
review queue using the existing native tools and harness. No new scheduler is
needed for this scope.

1. For each real deliverable, name its outcome, source state, exclusive paths,
   prerequisites and discriminating acceptance checks. Identify the unresolved
   premise and how many dependent outputs it could invalidate. If the contract
   is already settled, the implementer states it as its first output; do not
   launch an additional planning agent merely to repeat it.
2. Group tightly coupled files under one worker. Split only where another
   worker can finish a useful independent result without recurring negotiation.
3. Dispatch ready work promptly. Prefer the task delaying the next verified
   commit; do not optimize agent occupancy.
4. Use native children when the available slots and messaging suit the task.
   Use independent native `codex exec` or Claude sessions for further useful
   breadth and explicit model selection. These sessions still obey root's
   read-only ownership and source contract.
5. On completion, inspect the result, release ownership and dispatch newly
   ready work. Reuse context when it is relevant; start a fresh session when
   independence, exact model selection or irrelevant accumulated context makes
   that preferable.
6. Designate an implementation contributor to synthesize the aggregate result
   as its final step. The workflow route identifies this actual worker and its
   model/effort. Retain every contributor's native identity and evidence.
   Reconcile completed packets incrementally so synthesis does not begin from
   scratch after the last difficult implementation finishes.
7. Root applies once; checks and independent final review use the exact stable
   candidate. Commit after workflow completion, then release the next source
   state. Proposals against earlier file contents must be freshly reconciled.

Each worker packet carries the source identity, governing clauses and oracle
provenance, assumptions, owned paths, actual native identity/model/effort,
selection reason, proposal, unresolved questions and relevant evidence. Retain
the parent attempt when a packet repairs earlier work. Before root changes the
checkout, finish or pause workers still reading that live source. Preparation
that continues from an already-read immutable packet remains labelled with its
old source identity and cannot be applied as a fresh proposal without reconciliation.

An extra worker helps when the dependency-path time it removes exceeds its
launch, context loading, handoff, reconciliation and repair overhead. Those
terms require observation; agent count alone cannot establish a speedup.
If completed proposals wait for integration or review, redirect ready capacity
toward evidence checks and review preparation. Do not add speculative proposals
that will go stale before root can apply them.

Flat delegation is the starting topology, not a universal winner. A tightly
coupled subsystem may benefit from one strong worker. A larger graph with
repeated local coordination may justify a native lead and children. Neither
choice changes the single-writer or build/resource rules.

## Model policy: starting hypotheses

The exact pairs below are admitted by
[delivery.mjs](../../tools/engineering-harness/src/delivery.mjs).
They are task-fit priors, not measured rankings or claims of equal capability.
An explicit Claude route is an intentional choice, not an automatic fallback.
More specific owner model selections take precedence.

| Work | Codex starting route | Explicit Claude candidate |
| --- | --- | --- |
| Build, test, format check, exact comparison | Deterministic tools through harness; no model | Same |
| Narrow extraction or sourced documentation | `gpt-5.6-luna` / `low` | `claude-sonnet-5` / `low` |
| Bounded implementation or test authoring with settled interfaces | `gpt-5.6-terra` / `medium` | `claude-sonnet-5` / `medium` |
| Routine independent review | `gpt-5.6-sol` / `medium` | `claude-sonnet-5` / `high` |
| Difficult Rust or semantic implementation | `gpt-5.6-sol` / `high` | `claude-opus-5` / `high` |
| Consequential judgment or unresolved correctness | `gpt-6-astra` / `high` | `claude-fable-5-1` / `high` for targeted review; Opus/high for implementation |

Keep the active coordinating conversation unchanged. Do not automatically pass
its model, effort or full history to every worker. Give each worker the relevant
contract, source references, exact source identity and acceptance checks.
Avoid repeated full-repository scans and full-conversation forks for small jobs.
Use deterministic tools directly for mechanical lookups when delegation itself
would add unnecessary overhead; do not create a model call to run every grep.

Escalate for a concrete unresolved invariant, contradictory specification,
semantic repair that ordinary reasoning has not resolved, or a substantive
review disagreement. Supply the failing example and disputed clause. Do not
require failure on a weaker model before assigning obviously difficult work
to a stronger one. Return subsequent routine work to its normal route when the
hard question closes. Max/Ultra retain the existing explicit-selection rules.

An additional expensive reviewer needs a named question that current checks
and review have not resolved. Different provider identity alone is not a reason
for routine duplicate implementation or a permanent panel of reviewers.

Claude's inspected `Agent` input accepts model aliases and has no effort field;
forks inherit the parent model, with effort inheritance still needing runtime
confirmation. Prefer an independent native session when an exact heterogeneous
model/effort pair cannot be expressed by the available child tool. Preserve
`nativeChildEnvironment("claude")` for its configured subscription gateway and
`nativeChildEnvironment("codex")` for Codex; do not read or print credentials.

## Concrete next allocation, once application execution is requested

Use one ordinary A+C workflow with the seven-path union below. The governing
behavior and detailed acceptance come from
[ADR-0046](../adr/0046-shacl-12-editors-draft-realignment.md).

| Assignment | Exclusive proposal ownership | Route and release condition |
| --- | --- | --- |
| A implementation and aggregate synthesis | `lib/oxshacl/src/srl/evaluate/native.rs`, `lib/oxshacl/src/srl/evaluate/policy.rs` | Sol/high for difficult graph/negation semantics. Publish the GD/GE contract first; remove policy rejection atomically with evaluator support. Synthesize all accepted contributions without silently altering another owner's files. |
| A independent oracle and fixtures | New `lib/oxshacl/tests/srl_data_semantics.rs`; `lib/oxshacl/src/srl/tests.rs`; `lib/oxshacl/tests/srl_query.rs` | Sol/medium for the combined semantic oracle and fixture task; Terra/medium remains a candidate for later settled fixture-only work. Derive expected behavior from clauses before reading A's implementation rationale; reconcile contracts, then implement fixtures for frozen GD, accumulating GE, sticky WHERE DATA and local NOT DATA. Replace obsolete DATA-rejection assertions; preserve IMPORTS coverage. |
| C processor handling and tests | `lib/oxshacl/src/sparql_rules.rs`, `lib/oxshacl/src/sparql_rules/tests.rs` | Terra/medium, or explicitly selected Sonnet/medium. Confirm the MUST clause and supported identity; distinguish unknown, supported and absent processor values. Independent of A. |

These three ready assignments can use native children or independent native
sessions. Extra ready work can use further independent Codex or Claude sessions;
the allocation is not derived from the current conversation's child-slot count.
Claude can own C or oracle work through an explicit route without a mandatory lead.

A's GD/GE contract can be settled quickly from ADR-0046. If fixture work must
repeatedly wait for new interfaces, retain the independent oracle but transfer
fixture proposal ownership explicitly to A's stronger implementer. Never have
both workers submit competing full-file replacements.

When proposals finish, root applies the combined result and runs ordered checks.
Only then dispatch a fresh final reviewer, normally Sol/medium, who contributed
neither implementation nor fixtures. Give it clauses, the independently derived
oracle, the exact candidate and actual results. Independent acceptance analysis
can overlap implementation; final acceptance cannot precede those results.

After A+C is committed, release B abbreviations and D inference-layer work
against the new source. Their shared-file and evidence-contract dependencies
remain as documented in the earlier inventory. B must review the body-policy
assertion in `srl_clause_inventory.rs` without silently changing pins. E's suite
repin remains last and needs its exact evidence review and admitted tooling
paths. Completed FOR/IN removal is not reopened.

### Source states and expansion

| State/boundary | Ready work | What remains dependent |
| --- | --- | --- |
| S0: current committed source | A semantic implementation, independent A oracle and C implementation. A fixture generation follows agreement on the independently derived contract. | B/D source proposals wait for A/C; final review waits for applied source and checks. |
| S0: useful extra preparation | A fourth worker can settle B's next interface. Further independent workers can prepare D's contract, E's non-mutating inventory, one selected G3 oracle and the G4.2 cancellation-observation seam. These eight assignments are an example ready queue, not a target size or cap. | Each preparation task needs a named deliverable and source-labelled packet. Do not duplicate an already answered question. Respect the three active delivery-task policy by keeping these bounded subtasks of selected delivery/research work. |
| Candidate S0': aggregate applied | Root runs checks; independent reviewers inspect the fixed candidate when results are available. Free workers can finish relevant acceptance preparation. | No checkout edits or commits during source-bound checks/review. Live-source readers must finish or pause before another application boundary. |
| S1: A+C verified and committed | B and D proposals with released, exclusive shared paths. Reconcile earlier preparation against S1. | B's protected clause-inventory contract needs its narrow review; E repin waits for corrected behavior and exact evidence authority. |
| S2: required behavior verified | E's admitted tooling/evidence update, once its actual prerequisites are satisfied. Refill implementation from the next selected G3/G4 contract. | No artificial wait to fill a batch, and no presumption that every remaining lane is ready. |

Beyond that example queue, additional workers are justified only by another
ready bounded question, such as a distinct G3.2/G3.4/G3.5 oracle or a precise
G4.3 gap. Each has its own evidence and ownership. Redirect capacity as review
or integration becomes the limiting stage; do not generate a pile of obsolete
full-file proposals.

## Comparison with the remaining programme

The priority below is a proposed dispatch order, not application authorization.
Source checks override stale backlog wording. "Buildable" describes development
readiness; it does not establish that the current tests pass or grant promotion.

| Remaining lane | Dependency and useful parallel work | Starting model allocation |
| --- | --- | --- |
| SHACL A+C, then B+D | Highest-priority concrete wave above. Shared evaluation and SPARQL-rule files force successive source states; independent oracle/fixture work overlaps implementation. Repin follows corrected behavior and exact evidence review. | Sol/high for semantic implementation; Sol/medium for the combined A oracle/fixture task; Terra/medium for C and later settled fixture-only tasks; fresh Sol/medium final review. |
| G4.2 cancellation measurement | Define cancellation-signal-to-observed-stop instrumentation, then a drill that measures it. Likely seams: `cli/src/workload/metrics.rs`, `cli/src/workload/resource_metrics.rs`, `cli/src/workload.rs`; establish the exact observation seam before assigning edits. Workload/acceptance design can proceed independently; measurement execution waits for instrumentation and the build/resource lane. | Sol/high for measurement semantics; Terra/medium for settled fixtures. No model for the actual drill. |
| G3 acceptance evidence | G3.2 differential harness; G3.4 indexed-versus-oracle evaluation across 24 relations; G3.5 controlled-loopback SERVICE fixtures. Existing test surfaces include `lib/oxigraph/tests/bounded_join_planning.rs`, `spatial_index.rs`, `spatial_service.rs`. Independent oracle/fixture design is useful alongside SHACL; actual runs remain serialized where resources compete. | Terra/medium for bounded fixtures; Sol/high for planner/differential interpretation; independent Sol/medium evidence review. |
| G3.5 federation planner | Endpoint catalog with a real consumer, source selection, bound-join batching and telemetry. Explicit HTTP SERVICE is already the baseline. Settle the planner/consumer interface before distributing code; arbitrate overlap with G3.2 optimizer/evaluator work. | Sol/high interface/implementation; Terra/medium independent loopback fixtures. No unused catalog scaffolding. |
| G4.3 storage evidence | Exact remaining history/derived-state reconciliation and cross-profile acceptance, beyond extensive implemented upgrade/crash families. First identify the missing case against current source. Shared storage/database fixtures need exclusive resources. Missing system RocksDB affects its exact lane, not every task. | Sol/high for exact-gap and evaluator design; Terra/medium for specified fixtures. |
| G4.5 remote transactions, then RDF4J leased transactions | Owned transaction handle, lease state model and protocol precede failure/recovery and admission checks. Stabilize these interfaces before broad implementation. Independent state-model and wire-case design can overlap; shared CLI/store transaction files need explicit ownership. | Sol/high state-machine/interface work; Terra/medium bounded wire fixtures; independent consequential review when an invariant remains unresolved. |
| Later G4.6-G4.8 lanes | Repository lifecycle depends on G2.7/G4.1-G4.3; incremental entailment on G2.3c/G2.7; analytical research on G3.2, with additional G4.2 conditions for server/default promotion. Select exact contracts/files before dispatch. | Strong interface reasoning plus bounded independent model/oracle work, not an unbounded implementation swarm. |

Contracts: [delivery gates](oxigraph-delivery-gates.md),
[ADR-0027 workload admission](../adr/0027-workload-admission-and-operator-resources.md),
[ADR-0025 federation](../adr/0025-explicit-service-federation.md),
[ADR-0030 remote transactions](../adr/0030-leased-remote-http-transactions.md),
[evolution plan](linked-data-store-evolution-harness-plan.md), and
[ADR-0044 development/operational boundaries](../adr/0044-post-deployment-production-tuning.md).
The table is a lane comparison; later rows require exact file inventories before
they become assignments. It is not evidence that all those interfaces are ready.

Do not dispatch these stale "remaining" items:

- `lease_clones_cancel_drop_and_unwind_hold_exact_capacity` already checks
  panic unwind, zero active leases and reacquisition in
  [workload tests](../../cli/src/workload/tests.rs).
- `denied_work_never_starts_transactions_evaluation_or_egress` already covers
  zero-work denial in [HTTP access tests](../../cli/tests/access_http.rs).
- `request_body_limits_refuse_framing_and_expansion_before_rdf_work` already
  covers encoded/decoded limits, gzip/deflate and chunked expansion there.
- All seven operator budgets have implementation and end-to-end coverage
  recorded in the delivery gates; aggregate DISTINCT was the last recorded gap.
- Envelope writing, explicit v2-to-v3 activation, FOR/IN removal, citation
  corrections and RDF4J statements/namespaces/context routes are delivered.
  Ordinary-open version-3 admission is an explicit non-goal, not an omitted task.

These are source/record findings, not fresh test results. Repeated rule firing
under issue #1069 remains the named upstream specification dependency. Production
numeric calibration and promotion are separate operational decisions; G1.7 is
not a prerequisite for ordinary application progress.

The practical consequence is **more independent acceptance preparation**, not
more writers. Once application execution is requested, SHACL delivery can
coexist with bounded G3 oracle and G4 measurement-design tasks within the existing
three-active-delivery-task policy. Only dependency-ready work is dispatched;
shared-source implementation still enters the one workflow/integration lane.

## Measuring the tradeoffs through useful work

The owner's latest request explicitly calls for balancing token use, speed and
accuracy. Treat tokens as observed work, with no dollar conversions, provider
quotas or hard token budgets. Smaller models do not necessarily use fewer total
tokens; a single stronger solution may avoid multiple repairs and explanations.

Record observations alongside existing local workflow/native evidence:

| Dimension | What to record |
| --- | --- |
| Identity/context | Task class, difficulty, exact model/effort, provider/client version, native ID, parent/child relationships, source and contract identity, supplied context. |
| Time | Ready, dispatched, first useful result, proposal accepted, applied, checks complete, review accepted and committed; distinguish dependency/queue/build/review waits. |
| Accuracy | Passing discriminating checks, independently supported findings, severity, false positives, defects discovered later, repairs and integration conflicts. Agreement is not an accuracy score. |
| Tokens | Native-reported input, output, cache-read/write and separately reported reasoning categories across implementation, analysis, synthesis, reviews and retries. |
| Coverage | Whether each usage observation includes children/retries; missing categories, failures with missing usage, and attribution uncertainty. |

Keep raw token categories in their native definitions. Cached input may already
be a subset of input; reasoning may already be included in output. Parent usage
may already include child usage. Do not add overlapping counters. Unknown usage
is unknown, not zero. Report per-provider totals separately where tokenizers or
accounting differ; their raw totals are not equivalent computation or money.

Native `codex exec --json` exposes JSONL events; installed source contains
`turn.completed` and usage fields. Claude supports `--output-format json` and
`stream-json`; its schema includes duration, usage, model usage and optional
subagent statistics. First useful execution must confirm which fields actually
arrive and their aggregation semantics. This discussion did not measure them.
Ordinary `workflow.mjs` kernel `latencyMs: 0` and cost fields are compatibility
placeholders, not measured performance or usage.

Start from repository role defaults with explicit difficult-task overrides.
Across subsequent comparable real tasks, alternate approved candidate routes
where useful and retain failed attempts as well as successes. Stratify by task
class and difficulty; do not rank Sol on A against Terra on the easier C task.
Report the individual observations and sample limitations before drawing a
general ranking. Do not duplicate application implementation solely to populate
a benchmark, or spin up idle sessions to demonstrate capacity.

Among routes meeting the same acceptance, prefer an observed improvement in
elapsed time or attributable tokens when it does not materially worsen the
other. If one is faster but uses more tokens, report that tradeoff; do not invent
weights to declare it optimal. Prioritize the critical path and meaningful
correctness risk when making the immediate task decision.

## Implementation boundary and remaining work

The harness update closes the demonstrated attribution gap in
`tools/engineering-harness/src/workflow.mjs`. Native results may now disclose
`contributors` with reported native client, worker ID, exact model/effort,
selection reason, source digest and scoped paths. The controller validates
identity shape, routes, source binding and exclusive proposal ownership,
accumulates all implementation participants across repairs, and rejects any
aggregate or delegated reviewer who participated in implementation. Analysis-only
implementation participants are included even when their owned paths are empty.
Review scopes may overlap. Omission preserves the existing sole-worker contract.
Every declared participant must bind to its stage's source digest: proposal
contributors to the pre-apply source and reviewer contributors to the candidate.
Earlier preparation must be actually reconciled, not merely relabelled.

The existing host still dispatches and synthesizes one aggregate result; there
is no assignment-DAG interpreter or scheduler. Full contributor attribution is
retained in content-bound events, with implementation IDs and review contributors
in the compact handoff. Full referenced events retain source and route details
for every rejected/check-failed attempt as well as the accepted one; the compact
deduplicated ID list is only an exclusion index. These records are host-supplied evidence, not independent
identity authentication or proof that undeclared participants do not exist.
The [README](../../tools/engineering-harness/README.md) documents the exact shape.

Do not repurpose
[routing/quality-router.mjs](../../tools/engineering-harness/src/routing/quality-router.mjs):
it is the frozen candidate quality router, uses equal sentinel prices, and has
a different history/acceptance contract. No new scheduler, learned model router,
token-usage schema, API transport or global concurrency setting is introduced here.

Before the first authorized delivery, prepare the actual task spec, current
source contract, ownership packet and exact native route for each contributor.
Use the existing `workflow --spec` controller, `relayWorkflowHost`, root-only
application and `run` checks. The first useful run resolves telemetry, launch
overhead and actual throughput uncertainty. It does not need to prove a maximum
session count first.

Report active native workers, ready/blocked assignments, review queue and the
single writer/build lane at dispatch and completion boundaries. Explain idle
capacity in terms of missing ready work, dependencies or integration pressure.
Keep Ruflo records separate from actual execution proof.

Repository recall was attempted through live structured MCP. It returned no
usable phase-gating pattern; the tool could not explicitly target the separate
user database, so cross-project recall was unavailable. Ruflo capability
grounding used `search_ruvnet`, source `ruflo/kb/capability-cards.md#ruflo`, plus
the live `guidance_brain` registry; neither substitutes for native run evidence.

## Setup acceptance

The code slice is confined to ordinary `workflow.mjs`, its focused tests and
documentation. Acceptance checks cover legacy sole-worker compatibility,
multi-provider contributor records beyond this session's child count,
exclusive proposal ownership, exact model/effort/selection rules, missing route
reasons, stale proposal/review digests, all-participant review exclusion across
failed checks and rejected reviews, exact evidence handoff and unchanged global
source stability. Independent native review found no correctness defects.

Validation completed on Node 24.14.1 and Node 20.20.2: the focused workflow
contracts pass 32/32 on each, followed by the README's eight-file setup matrix
at 96/96 on each. Document references, example JSON and whitespace checks pass.
This is deterministic harness self-validation;
it launches no application workflow or provider capacity benchmark. Native
throughput, child usage aggregation and the relative route rankings remain
questions for the first authorized useful delivery.
