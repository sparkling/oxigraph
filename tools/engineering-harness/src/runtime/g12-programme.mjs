import { createHash, randomUUID } from "node:crypto";

import { disposeCandidate, reconstructCandidate } from "../candidate/reconstruct.mjs";
import { materializeFrozenSubmodules } from "../candidate/submodules.mjs";
import { verifyCandidate } from "../candidate/verifier.mjs";
import {
  g12ContractPath,
  g13ContractPath,
  g14ContractPath,
  g15ContractPath,
  g15bContractPath,
} from "../contract.mjs";
import { repositoryRoot } from "../paths.mjs";
import { validateWorkerOutput } from "../policy/authority.mjs";
import {
  createApplicationReceipt,
  replayApplicationReceipt,
  serializeApplicationReceipt,
  verifyApplicationReceipt,
} from "../receipts/application.mjs";
import { QualityFirstRouter } from "../routing/quality-router.mjs";
import { RouterHistory } from "../routing/history.mjs";
import { taskProfile } from "../task-profile.mjs";
import { admitApplicationReceipt } from "./application-admission.mjs";
import { currentControlIdentity } from "./control-identity.mjs";
import {
  CANDIDATE_ROLES,
  candidateProviderPlans,
  candidateSha256,
  chooseVerifiedCandidate,
  reviewProviderPlan,
  routeRoles,
  upstreamRoleOutputs,
} from "./lifecycle.mjs";
import { NativeWorkerPool } from "./native-pool.mjs";
import { runTaskPreflight } from "./preflight.mjs";
import {
  isIgnoredRuntimePath,
  readPrivateRuntimeArtifact,
  runtimePath,
  writePrivateRuntimeArtifact,
} from "./storage.mjs";
import { createTaskContext } from "./task-context.mjs";
import {
  runUpstreamAttempt,
  upstreamFailureSummary,
} from "./upstream.mjs";

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PROVIDERS = Object.freeze(["codex", "claude"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireRunId(runId) {
  if (typeof runId !== "string" || !SAFE_RUN_ID.test(runId)) {
    throw new Error("engineering programme runId must be a safe bounded identifier");
  }
  return runId;
}

function isoNow(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("engineering programme clock is invalid");
  return date.toISOString();
}

function abortBeforeEvidence(signal) {
  if (signal?.aborted) {
    const error = new Error("engineering programme cancelled before native evidence");
    error.code = "OXIGRAPH_CANCELLED";
    throw error;
  }
}

function providerModelsByRole(providersByRole, models, roles) {
  return Object.freeze(
    Object.fromEntries(roles.map((role) => [role, models[providersByRole[role]]])),
  );
}

function currentCandidate(attempt) {
  return Object.freeze({
    patch: attempt.patch,
    patchSha256: attempt.patchSha256,
    commit: attempt.candidate.commit,
    tree: attempt.candidate.tree,
    protectedManifest: attempt.candidate.protectedManifest,
  });
}

function priorOutputsFromUpstream(input) {
  const result = {};
  for (const [step, output] of Object.entries(input.upstream ?? {})) {
    const role = step.slice(step.lastIndexOf(":") + 1);
    if (CANDIDATE_ROLES.includes(role)) result[role] = output;
  }
  return result;
}

function successfulInvocation(invocation) {
  return (
    invocation.status !== "ERROR" &&
    invocation.status !== "INCONCLUSIVE" &&
    invocation.process?.disposition === "completed" &&
    invocation.process.exitCode === 0 &&
    invocation.process.signal === null
  );
}

function actionableProductRejection(verifier) {
  if (
    verifier?.verdict !== "REJECT" ||
    !Array.isArray(verifier.commands) ||
    !Array.isArray(verifier.artifacts) ||
    verifier.artifacts.length === 0 ||
    verifier.commands.some(
      (command) =>
        command.disposition !== "completed" ||
        command.exitCode === null ||
        command.signal !== null,
    )
  ) {
    return false;
  }
  const expected = { format: 1, build: 2, evaluation: 5 }[verifier.stage];
  if (expected !== verifier.commands.length) return false;
  if (verifier.stage === "format") return verifier.commands[0].exitCode !== 0;
  if (verifier.commands[0].exitCode !== 0) return false;
  if (verifier.stage === "build") return verifier.commands[1].exitCode !== 0;
  return verifier.commands[1].exitCode === 0;
}

function receiptContract(preflight) {
  return Object.freeze({
    sha256: preflight.contractSha256,
    baseline: Object.freeze({ ...preflight.contract.baseline }),
    evaluator: Object.freeze({
      commit: preflight.contract.evaluator.commit,
      tree: preflight.contract.evaluator.tree,
      patchSha256: preflight.contract.evaluator.patchSha256,
    }),
    success: Object.freeze({ ...preflight.contract.success }),
  });
}

function receiptControl(preflight, models) {
  return Object.freeze({
    harnessSha256: preflight.control.harnessSha256,
    providerModels: Object.freeze({ ...models }),
  });
}

function testStructuralOutput(output, context) {
  validateWorkerOutput(output, context.step.kind);
  return Object.freeze({ pass: true, score: 1, reasons: Object.freeze([]) });
}

function boundedIssue(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

function defaultOperations() {
  return Object.freeze({
    preflight: (options) => runTaskPreflight(options),
    router: (history) => new QualityFirstRouter({ history }),
    pool: (contract) => new NativeWorkerPool({ contract }),
    runAttempt: runUpstreamAttempt,
    taskContext: createTaskContext,
    reconstruct: reconstructCandidate,
    materializeSubmodules: materializeFrozenSubmodules,
    verify: verifyCandidate,
    dispose: disposeCandidate,
    createReceipt: createApplicationReceipt,
    serializeReceipt: serializeApplicationReceipt,
  });
}

async function executeProgramme(
  {
    runId = randomUUID(),
    signal,
    repoRoot = repositoryRoot,
    contractPath = g12ContractPath,
    clock = () => new Date(),
  } = {},
  operations,
) {
  requireRunId(runId);
  if (typeof clock !== "function") throw new Error("engineering programme requires a clock");
  abortBeforeEvidence(signal);
  const startedAt = isoNow(clock);
  const preflight = await operations.preflight({ signal, repoRoot, contractPath });
  const contract = preflight.contract;
  const profile = taskProfile(contract);
  const pool = operations.pool(contract);
  const models = pool.models;
  const declaredModels = Object.fromEntries(
    contract.routing.providers.map(({ provider, model }) => [provider, model]),
  );
  if (PROVIDERS.some((provider) => models[provider] !== declaredModels[provider])) {
    throw new Error("native pool models do not match the frozen task contract");
  }
  const history = await operations.history({ preflight, repoRoot });
  const router = operations.router(history);
  const applicationTaskId = `${contract.id}:${runId}`;
  const baseRoutingContext = Object.freeze({
    taskId: applicationTaskId,
    taskClass: profile.taskClass,
    contractSha256: preflight.contractSha256,
    evaluatorSha256: contract.evaluator.patchSha256,
    harnessSha256: preflight.control.harnessSha256,
    models,
  });

  const routing = [];
  const nativeInvocations = [];
  const attempts = [];
  const reviews = [];
  const events = [];
  const issues = [];
  const executionRoutes = new Map();
  const invocationIdsByExecution = new Map();
  const priorOutputsByAttempt = new Map();
  let routeSequence = 0;
  let attemptSequence = 0;
  let reviewSequence = 0;
  let capturedEvidence = 0;

  function addRoutes(taskId, decisions, roles) {
    const byRole = new Map();
    for (const role of roles) {
      const record = Object.freeze({
        id: `${runId}:route:${++routeSequence}:${role}`,
        role,
        context: Object.freeze({ ...baseRoutingContext, taskId, role }),
        decision: decisions[role],
      });
      routing.push(record);
      events.push(Object.freeze({ kind: "routing", id: record.id }));
      byRole.set(role, record);
    }
    return byRole;
  }

  function bindExecution(executionId, routes) {
    if (executionRoutes.has(executionId)) {
      throw new Error(`duplicate native execution id: ${executionId}`);
    }
    executionRoutes.set(executionId, routes);
  }

  function captureNativeEvidence() {
    const fresh = pool
      .evidence()
      .filter(({ sequence }) => sequence > capturedEvidence)
      .sort((left, right) => left.sequence - right.sequence);
    for (const evidence of fresh) {
      if (evidence.sequence !== capturedEvidence + 1) {
        throw new Error("native pool evidence sequence is not contiguous");
      }
      const route = executionRoutes.get(evidence.executionId)?.get(evidence.role);
      if (route === undefined) {
        throw new Error("native pool evidence has no prior exact routing decision");
      }
      const record = Object.freeze({
        id: `${runId}:invocation:${evidence.sequence}`,
        routingId: route.id,
        ...evidence,
      });
      nativeInvocations.push(record);
      const ids = invocationIdsByExecution.get(evidence.executionId) ?? [];
      ids.push(record.id);
      invocationIdsByExecution.set(evidence.executionId, ids);
      events.push(Object.freeze({ kind: "native-invocation", id: record.id }));
      capturedEvidence = evidence.sequence;
    }
  }

  function invocationFor(executionId, role, output) {
    const ids = invocationIdsByExecution.get(executionId) ?? [];
    const expectedPatch = output.patch === null ? null : sha256(output.patch);
    const matching = ids
      .map((id) => nativeInvocations.find((item) => item.id === id))
      .filter(
        (item) =>
          item?.role === role &&
          item.status === output.verdict &&
          item.patchSha256 === expectedPatch &&
          successfulInvocation(item),
      );
    const invocation = matching.at(-1);
    if (invocation === undefined) {
      throw new Error(`${executionId} lacks exact successful ${role} invocation evidence`);
    }
    return invocation;
  }

  async function runNativeExecution({
    intent,
    executionId,
    providersByRole,
    routes,
    goal,
    taskFactory,
  }) {
    bindExecution(executionId, routes);
    try {
      const selected = pool.agentsFor({
        intent,
        providersByRole,
        taskFactory,
        signal,
        executionId,
      });
      const run = await operations.runAttempt({
        intent,
        goal,
        selectedAgents: selected.selectedAgents,
        recoveries: selected.recoveries,
        structuralCheck: testStructuralOutput,
        runId: executionId,
      });
      const failure = upstreamFailureSummary(run);
      if (failure !== null) issues.push(`${executionId}: ${failure}`);
      return Object.freeze({ executionId, providersByRole, run });
    } catch (error) {
      issues.push(`${executionId}: ${boundedIssue(error)}`);
      return Object.freeze({ executionId, providersByRole, error });
    }
  }

  async function evaluatePatch({
    execution,
    output,
    roles,
    parentAttemptId,
    repairCycle,
    originalPriorOutputs,
  }) {
    let candidate;
    let completed;
    let disposalFailed = false;
    try {
      candidate = await operations.reconstruct({
        repositoryRoot: repoRoot,
        contract,
        patch: output.patch,
      });
      await operations.materializeSubmodules({
        controllerRoot: repoRoot,
        candidate,
        contract,
      });
      const verifier = await operations.verify({ candidate, contract, signal });
      const invocationIds = roles.map(
        (role) => invocationFor(execution.executionId, role, output.outputs[role]).id,
      );
      const providersByRole = Object.freeze(
        Object.fromEntries(roles.map((role) => [role, execution.providersByRole[role]])),
      );
      const record = Object.freeze({
        id: `${runId}:attempt:${++attemptSequence}`,
        parentAttemptId,
        roles: Object.freeze([...roles]),
        providersByRole,
        modelsByRole: providerModelsByRole(providersByRole, models, roles),
        invocationIds: Object.freeze(invocationIds),
        upstreamReceipts: execution.run.receipts,
        patch: output.patch,
        patchSha256: candidateSha256(candidate),
        candidate: Object.freeze({
          commit: candidate.candidateCommit,
          tree: candidate.candidateTree,
          protectedManifest: candidate.protectedManifest,
        }),
        verifier,
        repairCycle,
        disposition: verifier.verdict,
      });
      completed = Object.freeze({
        ...record,
        candidateSha256: record.patchSha256,
        candidateProvider:
          execution.providersByRole[repairCycle === 0 ? "implementation" : "repair"],
        repairCycles: repairCycle,
        measuredCostUsd: execution.run.totalCostUsd ?? 0,
      });
    } catch (error) {
      issues.push(`${execution.executionId}: ${boundedIssue(error)}`);
    } finally {
      if (candidate !== undefined) {
        try {
          await operations.dispose(candidate);
        } catch (error) {
          disposalFailed = true;
          issues.push(`${execution.executionId}: disposal: ${boundedIssue(error)}`);
        }
      }
    }
    if (completed === undefined || disposalFailed) return null;
    attempts.push(completed);
    priorOutputsByAttempt.set(completed.id, originalPriorOutputs);
    events.push(Object.freeze({ kind: "attempt", id: completed.id }));
    return completed;
  }

  const candidateDecisions = await routeRoles(router, baseRoutingContext);
  const candidateRoutes = addRoutes(applicationTaskId, candidateDecisions, CANDIDATE_ROLES);
  const candidatePlans = candidateProviderPlans(candidateDecisions);
  const candidateExecutions = await Promise.all(
    candidatePlans.map((plan, index) => {
      const executionId = `${runId}:candidate:${index + 1}`;
      return runNativeExecution({
        intent: "oxigraph-candidate",
        executionId,
        providersByRole: plan.providersByRole,
        routes: candidateRoutes,
        goal: {
          text: contract.objective,
          context: Object.freeze({ taskId: applicationTaskId, localOnly: true }),
        },
        taskFactory: ({ role, input }) => {
          const priorOutputs = priorOutputsFromUpstream(input);
          const task = {
            role,
            sourceSnapshot: preflight.sourceSnapshot,
            contract,
            contractSha256: preflight.contractSha256,
          };
          if (role !== "architecture") task.priorOutputs = priorOutputs;
          return operations.taskContext(task);
        },
      });
    }),
  );
  captureNativeEvidence();

  for (const execution of candidateExecutions) {
    if (execution.error !== undefined || execution.run.success !== true) continue;
    try {
      const outputs = upstreamRoleOutputs(execution.run, CANDIDATE_ROLES);
      if (CANDIDATE_ROLES.some((role) => outputs[role].verdict !== "ACCEPT")) {
        issues.push(`${execution.executionId}: candidate pipeline declined application`);
        continue;
      }
      await evaluatePatch({
        execution,
        output: Object.freeze({
          patch: outputs.implementation.patch,
          outputs,
        }),
        roles: CANDIDATE_ROLES,
        parentAttemptId: null,
        repairCycle: 0,
        originalPriorOutputs: outputs,
      });
    } catch (error) {
      issues.push(`${execution.executionId}: ${boundedIssue(error)}`);
    }
  }

  let selected = chooseVerifiedCandidate(attempts);
  let repairParent =
    selected === null
      ? attempts.find(({ verifier }) => actionableProductRejection(verifier)) ?? null
      : null;
  for (
    let cycle = 1;
    selected === null &&
    repairParent !== null &&
    cycle <= contract.ceilings.maxRepairCycles &&
    signal?.aborted !== true;
    cycle += 1
  ) {
    const repairTaskId = `${runId}:repair:${repairParent.id}:${cycle}`;
    const repairDecisions = await routeRoles(
      router,
      { ...baseRoutingContext, taskId: repairTaskId },
      ["repair"],
    );
    const repairRoutes = addRoutes(repairTaskId, repairDecisions, ["repair"]);
    const decision = repairDecisions.repair;
    const repairProviders =
      decision.mode === "paired" ? decision.providers : [decision.provider];
    const parentForCycle = repairParent;
    const originalPriorOutputs = priorOutputsByAttempt.get(parentForCycle.id);
    const repairExecutions = await Promise.all(
      repairProviders.map((provider) => {
        const executionId = `${runId}:repair:${cycle}:${provider}`;
        return runNativeExecution({
          intent: "oxigraph-repair",
          executionId,
          providersByRole: Object.freeze({ repair: provider }),
          routes: repairRoutes,
          goal: {
            text: `Repair ${contract.id} candidate ${parentForCycle.id}`,
            context: Object.freeze({ taskId: repairTaskId, localOnly: true }),
          },
          taskFactory: ({ role }) =>
            operations.taskContext({
              role,
              sourceSnapshot: preflight.sourceSnapshot,
              contract,
              contractSha256: preflight.contractSha256,
              priorOutputs: originalPriorOutputs,
              currentCandidate: currentCandidate(parentForCycle),
              verifierReceipt: parentForCycle.verifier,
            }),
        });
      }),
    );
    captureNativeEvidence();
    const cycleAttempts = [];
    for (const execution of repairExecutions) {
      if (execution.error !== undefined || execution.run.success !== true) continue;
      try {
        const outputs = upstreamRoleOutputs(execution.run, ["repair"]);
        if (outputs.repair.verdict !== "ACCEPT") {
          issues.push(`${execution.executionId}: repair worker declined application`);
          continue;
        }
        const attempt = await evaluatePatch({
          execution,
          output: Object.freeze({ patch: outputs.repair.patch, outputs }),
          roles: Object.freeze(["repair"]),
          parentAttemptId: parentForCycle.id,
          repairCycle: cycle,
          originalPriorOutputs,
        });
        if (attempt !== null) cycleAttempts.push(attempt);
      } catch (error) {
        issues.push(`${execution.executionId}: ${boundedIssue(error)}`);
      }
    }
    selected = chooseVerifiedCandidate(attempts);
    repairParent =
      selected === null
        ? cycleAttempts.find(({ verifier }) => actionableProductRejection(verifier)) ?? null
        : null;
  }

  selected = chooseVerifiedCandidate(attempts);
  let reviewPlan = null;
  if (selected !== null && signal?.aborted !== true) {
    const reviewDecisions = await routeRoles(router, baseRoutingContext, ["review"]);
    const reviewRoutes = addRoutes(applicationTaskId, reviewDecisions, ["review"]);
    reviewPlan = reviewProviderPlan(reviewDecisions.review, selected.candidateProvider);
    const reviewExecutions = await Promise.all(
      reviewPlan.providers.map((provider) => {
        const executionId = `${runId}:review:${provider}`;
        return runNativeExecution({
          intent: "oxigraph-review",
          executionId,
          providersByRole: Object.freeze({ review: provider }),
          routes: reviewRoutes,
          goal: {
            text: `Review ${contract.id} candidate ${selected.id}`,
            context: Object.freeze({ taskId: applicationTaskId, localOnly: true }),
          },
          taskFactory: ({ role }) =>
            operations.taskContext({
              role,
              sourceSnapshot: preflight.sourceSnapshot,
              contract,
              contractSha256: preflight.contractSha256,
              priorOutputs: priorOutputsByAttempt.get(selected.id),
              currentCandidate: currentCandidate(selected),
              verifierReceipt: selected.verifier,
            }),
        });
      }),
    );
    captureNativeEvidence();
    for (const execution of reviewExecutions) {
      if (execution.error !== undefined || execution.run.success !== true) continue;
      try {
        const outputs = upstreamRoleOutputs(execution.run, ["review"]);
        const output = outputs.review;
        if (!["ACCEPT", "REJECT"].includes(output.verdict)) continue;
        const invocation = invocationFor(execution.executionId, "review", output);
        const provider = execution.providersByRole.review;
        const record = Object.freeze({
          id: `${runId}:review-record:${++reviewSequence}`,
          attemptId: selected.id,
          provider,
          model: models[provider],
          invocationId: invocation.id,
          upstreamReceipts: execution.run.receipts,
          candidateSha256: selected.patchSha256,
          outputSha256: invocation.outputSha256,
          disposition: output.verdict,
        });
        reviews.push(record);
        events.push(Object.freeze({ kind: "review", id: record.id }));
      } catch (error) {
        issues.push(`${execution.executionId}: ${boundedIssue(error)}`);
      }
    }
  }

  let final;
  if (selected === null) {
    const productRejected = attempts.some(({ verifier }) =>
      actionableProductRejection(verifier),
    );
    final = Object.freeze({
      verdict: productRejected ? "REJECT" : "INCONCLUSIVE",
      reason: productRejected
        ? "every application-verifiable candidate failed the frozen verifier"
        : `no application-verifiable candidate was produced${issues.length === 0 ? "" : `: ${issues[0]}`}`,
    });
  } else {
    const requiredReviews = reviewPlan?.providers.length ?? 0;
    const selectedReviews = reviews.filter(({ attemptId }) => attemptId === selected.id);
    const explicitReject = selectedReviews.some(({ disposition }) => disposition === "REJECT");
    const allAccepted =
      selectedReviews.length === requiredReviews &&
      requiredReviews > 0 &&
      selectedReviews.every(({ disposition }) => disposition === "ACCEPT");
    const crossVendorAccepted = selectedReviews.some(
      ({ provider, disposition }) =>
        provider !== selected.candidateProvider && disposition === "ACCEPT",
    );
    final = Object.freeze({
      verdict: explicitReject
        ? "REJECT"
        : allAccepted && reviewPlan.crossVendorAvailable && crossVendorAccepted
          ? "ACCEPT"
          : "INCONCLUSIVE",
      reason: explicitReject
        ? "an independently routed review rejected the selected candidate"
        : allAccepted && reviewPlan.crossVendorAvailable && crossVendorAccepted
          ? "the frozen verifier and every required cross-vendor review accepted the candidate"
          : "the selected candidate lacks a complete receipt-valid cross-vendor review",
    });
  }

  if (nativeInvocations.length === 0) {
    throw new Error(`${profile.label} programme produced no native invocation evidence`);
  }
  const selectedCandidate =
    selected === null
      ? null
      : Object.freeze({
          attemptId: selected.id,
          patchSha256: selected.patchSha256,
          commit: selected.candidate.commit,
          tree: selected.candidate.tree,
        });
  events.push(
    Object.freeze({
      kind: "selected-candidate",
      id: selectedCandidate?.attemptId ?? "none",
    }),
  );
  events.push(Object.freeze({ kind: "final", id: runId }));
  const completedAt = isoNow(clock);
  const receipt = operations.createReceipt({
    run: Object.freeze({
      id: runId,
      taskId: applicationTaskId,
      taskClass: profile.taskClass,
      startedAt,
      completedAt,
    }),
    control: receiptControl(preflight, models),
    contract: receiptContract(preflight),
    routing,
    nativeInvocations,
    attempts: attempts.map(
      ({
        candidateSha256: _candidateSha256,
        candidateProvider: _candidateProvider,
        repairCycles: _repairCycles,
        measuredCostUsd: _measuredCostUsd,
        ...record
      }) => record,
    ),
    reviews,
    selectedCandidate,
    final,
    events,
  });
  const receiptBytes = operations.serializeReceipt(receipt);
  const finalized = await operations.finalize({
    runId,
    receipt,
    receiptBytes,
    preflight,
    history,
    repoRoot,
  });
  return Object.freeze({
    schema: `oxigraph.${profile.slug}-programme-result/v1`,
    runId,
    taskId: applicationTaskId,
    final,
    selectedCandidate,
    selectedPatch: selected?.patch ?? null,
    receiptSha256: receipt.receiptSha256,
    receiptPath: finalized.receiptPath,
    admittedOutcomes: finalized.admission.outcomeCount,
    issues: Object.freeze([...issues]),
  });
}

async function productionHistory() {
  const path = await runtimePath("router-history.jsonl");
  return RouterHistory.open({ path, isIgnoredRuntimePath });
}

async function productionFinalize({
  runId,
  receiptBytes,
  preflight,
  history,
  repoRoot,
}) {
  const profile = taskProfile(preflight.contract);
  const receiptName = `${profile.slug}-application-${runId}.json`;
  const receiptPath = await writePrivateRuntimeArtifact(receiptName, receiptBytes);
  try {
    const freshControl = await currentControlIdentity({
      contract: preflight.contract,
      repoRoot,
    });
    const admission = await admitApplicationReceipt({
      receiptBytes,
      preflight: Object.freeze({ ...preflight, control: freshControl }),
      history,
    });
    return Object.freeze({ receiptPath, admission });
  } catch (error) {
    error.receiptPath = receiptPath;
    throw error;
  }
}

/** Execute a committed, local-only task programme with native providers. */
export async function runTaskProgramme(options = {}) {
  return executeProgramme(options, {
    ...defaultOperations(),
    history: productionHistory,
    finalize: productionFinalize,
  });
}

export function runG12Programme(options = {}) {
  return runTaskProgramme({ ...options, contractPath: g12ContractPath });
}

export function runG13Programme(options = {}) {
  return runTaskProgramme({ ...options, contractPath: g13ContractPath });
}

export function runG14Programme(options = {}) {
  return runTaskProgramme({ ...options, contractPath: g14ContractPath });
}

export function runG15Programme(options = {}) {
  return runTaskProgramme({ ...options, contractPath: g15ContractPath });
}

export function runG15bProgramme(options = {}) {
  return runTaskProgramme({ ...options, contractPath: g15bContractPath });
}

/**
 * Test-only construction seam. It cannot use production persistence or
 * admission; callers must supply isolated history and finalize operations.
 */
export function createG12ProgrammeForTesting(overrides) {
  if (
    overrides === null ||
    typeof overrides !== "object" ||
    typeof overrides.history !== "function" ||
    typeof overrides.finalize !== "function"
  ) {
    throw new Error("test engineering programme requires isolated history and finalize operations");
  }
  const operations = Object.freeze({ ...defaultOperations(), ...overrides });
  return (options = {}) => executeProgramme(options, operations);
}

/** Replay one private receipt against a fresh red preflight and current control. */
export async function replayTaskProgrammeReceipt({
  name,
  signal,
  repoRoot = repositoryRoot,
  contractPath = g12ContractPath,
}) {
  const receiptBytes = (await readPrivateRuntimeArtifact(name)).toString("utf8");
  const receipt = replayApplicationReceipt(receiptBytes);
  const independent = verifyApplicationReceipt(receiptBytes);
  if (!independent.ok || receipt.run.id.length === 0) {
    throw new Error("stored task receipt failed independent replay");
  }
  const preflight = await runTaskPreflight({ signal, repoRoot, contractPath });
  const profile = taskProfile(preflight.contract);
  const history = await productionHistory();
  const freshControl = await currentControlIdentity({
    contract: preflight.contract,
    repoRoot,
  });
  const admission = await admitApplicationReceipt({
    receiptBytes,
    preflight: Object.freeze({ ...preflight, control: freshControl }),
    history,
  });
  return Object.freeze({
    schema: `oxigraph.${profile.slug}-replay-result/v1`,
    runId: receipt.run.id,
    final: receipt.final,
    selectedCandidate: receipt.selectedCandidate,
    receiptSha256: receipt.receiptSha256,
    admittedOutcomes: admission.outcomeCount,
  });
}

export function replayG12ProgrammeReceipt(options) {
  return replayTaskProgrammeReceipt({ ...options, contractPath: g12ContractPath });
}

export function replayG13ProgrammeReceipt(options) {
  return replayTaskProgrammeReceipt({ ...options, contractPath: g13ContractPath });
}

export function replayG14ProgrammeReceipt(options) {
  return replayTaskProgrammeReceipt({ ...options, contractPath: g14ContractPath });
}

export function replayG15ProgrammeReceipt(options) {
  return replayTaskProgrammeReceipt({ ...options, contractPath: g15ContractPath });
}

export function replayG15bProgrammeReceipt(options) {
  return replayTaskProgrammeReceipt({ ...options, contractPath: g15bContractPath });
}
