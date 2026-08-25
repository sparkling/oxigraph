import {
  AgentPool,
  AlgorithmRouter,
  CircuitBreaker,
  HarnessKernel,
  PolicyGate,
  RetryBudget,
  VerifierRegistry,
  allowTools,
} from "@metaharness/harness";
import { randomUUID } from "node:crypto";

const FAILURE_SCHEMA = "oxigraph.engineering-worker-failure/v1";
const RESERVED_CONTEXT_KEYS = new Set(["goal", "step"]);
const recoveryControllers = new WeakSet();

export const UPSTREAM_STRATEGIES = deepFreeze({
  "oxigraph-candidate": {
    intent: "oxigraph-candidate",
    steps: [
      { kind: "architecture" },
      { kind: "critique", deps: ["architecture"] },
      { kind: "implementation", deps: ["architecture", "critique"] },
    ],
  },
  "oxigraph-review": {
    intent: "oxigraph-review",
    steps: [{ kind: "review" }],
  },
  "oxigraph-repair": {
    intent: "oxigraph-repair",
    steps: [{ kind: "repair" }],
  },
});

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function plainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new Error(`${label} must be a plain object`);
  }
  return value;
}

function finiteNumber(value, label, { min = -Infinity, max = Infinity } = {}) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a finite number in [${min}, ${max}]`);
  }
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function jsonClone(value, label) {
  const seen = new Set();
  function validate(item, path) {
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean"
    ) {
      return;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error(`${path} must be finite`);
      return;
    }
    if (Array.isArray(item)) {
      if (seen.has(item)) throw new Error(`${path} must not contain cycles`);
      seen.add(item);
      item.forEach((child, index) => validate(child, `${path}[${index}]`));
      seen.delete(item);
      return;
    }
    if (
      item !== null &&
      typeof item === "object" &&
      [Object.prototype, null].includes(Object.getPrototypeOf(item))
    ) {
      if (seen.has(item)) throw new Error(`${path} must not contain cycles`);
      seen.add(item);
      for (const [key, child] of Object.entries(item)) {
        validate(child, `${path}.${key}`);
      }
      seen.delete(item);
      return;
    }
    throw new Error(`${path} is not a JSON value`);
  }
  validate(value, label);
  return JSON.parse(JSON.stringify(value));
}

function boundedMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 512);
}

function failureOutput(code, reasons) {
  return Object.freeze({
    output: deepFreeze({
      schema: FAILURE_SCHEMA,
      code,
      reasons: reasons.map((reason) => String(reason).slice(0, 512)),
    }),
    quality: 0,
    confidence: 0,
    risk: 0,
    costUsd: 0,
    latencyMs: 0,
  });
}

function isFailureOutput(output) {
  return output?.schema === FAILURE_SCHEMA;
}

export function upstreamFailureSummary(run) {
  if (run?.success === true) return null;
  if (!Array.isArray(run?.steps)) return "run-failed";
  for (const entry of run.steps) {
    if (entry?.verdict?.pass === true) continue;
    const role =
      typeof entry?.step?.kind === "string" ? entry.step.kind : "unknown-role";
    const output = entry?.output?.output;
    const code = isFailureOutput(output) ? output.code : "structural-rejection";
    return `${role}:${code}`.slice(0, 512);
  }
  return "run-failed";
}

function normalizeWorkerOutput(raw, agentId) {
  plainObject(raw, `${agentId} worker output`);
  const output = jsonClone(raw.output, `${agentId}.output`);
  finiteNumber(raw.quality, `${agentId}.quality`, { min: 0, max: 1 });
  const confidence = finiteNumber(raw.confidence, `${agentId}.confidence`, {
    min: 0,
    max: 1,
  });
  const risk = finiteNumber(raw.risk, `${agentId}.risk`, { min: 0, max: 1 });
  const costUsd = finiteNumber(raw.costUsd, `${agentId}.costUsd`, { min: 0 });
  const latencyMs = finiteNumber(raw.latencyMs, `${agentId}.latencyMs`, {
    min: 0,
  });
  return Object.freeze({
    output: deepFreeze(output),
    // Upstream AgentPool learns this field after merely structural verification.
    // Oxigraph keeps that process-local signal deliberately neutral and admits
    // routing quality only after the independent application verifier.
    quality: 0,
    confidence,
    risk,
    costUsd,
    latencyMs,
  });
}

function normalizeVerdict(value, verifierId) {
  if (typeof value === "boolean") {
    return {
      pass: value,
      score: value ? 1 : 0,
      reasons: value ? [] : [`${verifierId}: structural verification failed`],
    };
  }
  plainObject(value, `${verifierId} verdict`);
  if (typeof value.pass !== "boolean") {
    throw new Error(`${verifierId} verdict.pass must be boolean`);
  }
  const score = finiteNumber(value.score, `${verifierId} verdict.score`, {
    min: 0,
    max: 1,
  });
  if (
    !Array.isArray(value.reasons) ||
    value.reasons.some((reason) => typeof reason !== "string")
  ) {
    throw new Error(`${verifierId} verdict.reasons must be strings`);
  }
  return {
    pass: value.pass,
    score,
    reasons: value.reasons.map((reason) => reason.slice(0, 512)),
  };
}

function strategyKinds(intent) {
  const strategy = UPSTREAM_STRATEGIES[intent];
  if (!strategy) throw new Error(`unsupported upstream intent: ${intent}`);
  const kinds = strategy.steps.map(({ kind }) => kind);
  if (new Set(kinds).size !== kinds.length) {
    throw new Error(`${intent} strategy contains duplicate step kinds`);
  }
  const known = new Set(kinds);
  for (const step of strategy.steps) {
    for (const dependency of step.deps ?? []) {
      if (!known.has(dependency)) {
        throw new Error(`${intent} strategy has unknown dependency: ${dependency}`);
      }
    }
  }
  return kinds;
}

export function validateUpstreamGoal(goal, intent) {
  plainObject(goal, "upstream goal");
  if (typeof goal.text !== "string" || goal.text.length === 0) {
    throw new Error("upstream goal.text must be non-empty");
  }
  if (goal.intent !== undefined && goal.intent !== intent) {
    throw new Error(`upstream goal intent must be ${intent}`);
  }
  const context = goal.context ?? {};
  plainObject(context, "upstream goal.context");
  for (const key of RESERVED_CONTEXT_KEYS) {
    if (Object.hasOwn(context, key)) {
      throw new Error(`upstream goal.context may not override ${key}`);
    }
  }
  return deepFreeze({
    text: goal.text,
    intent,
    context: jsonClone(context, "upstream goal.context"),
  });
}

export function createAttemptPolicy(
  intent,
  { actionRisk = 0.05, riskCeiling = 0.1 } = {},
) {
  finiteNumber(actionRisk, "actionRisk", { min: 0, max: 1 });
  finiteNumber(riskCeiling, "riskCeiling", { min: 0, max: 1 });
  if (actionRisk > riskCeiling) {
    throw new Error("actionRisk may not exceed riskCeiling");
  }
  return new PolicyGate([allowTools(strategyKinds(intent), actionRisk)], riskCeiling);
}

export function createHostRecovery({
  threshold = 2,
  cooldownMs = 1_000,
  maxRetries = 0,
  maxRetryUsd = 0,
  now = Date.now,
} = {}) {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error("host breaker threshold must be a positive integer");
  }
  if (!Number.isInteger(cooldownMs) || cooldownMs <= 0) {
    throw new Error("host breaker cooldown must be a positive integer");
  }
  nonnegativeInteger(maxRetries, "host maxRetries");
  finiteNumber(maxRetryUsd, "host maxRetryUsd", { min: 0 });
  if (typeof now !== "function") throw new Error("host clock must be a function");

  const breaker = new CircuitBreaker({ threshold, cooldownMs, now });
  const retryBudget = new RetryBudget(maxRetries, maxRetryUsd);
  let halfOpenInFlight = false;
  const controller = {
    acquire() {
      const state = breaker.current();
      if (state === "open" || (state === "half-open" && halfOpenInFlight)) {
        return false;
      }
      if (state === "half-open") halfOpenInFlight = true;
      return breaker.canProceed();
    },
    recordSuccess() {
      halfOpenInFlight = false;
      breaker.recordSuccess();
    },
    recordFailure() {
      halfOpenInFlight = false;
      breaker.recordFailure();
    },
    tryRetry(usd = 0) {
      finiteNumber(usd, "host retry cost", { min: 0 });
      return retryBudget.tryConsume(usd);
    },
    snapshot() {
      return Object.freeze({
        state: breaker.current(),
        retriesRemaining: retryBudget.remaining,
        retrySpendUsd: retryBudget.spentUsd,
      });
    },
  };
  recoveryControllers.add(controller);
  return Object.freeze(controller);
}

function selectedRecovery(recoveries, agentId) {
  if (recoveries === undefined) return undefined;
  const recovery =
    recoveries instanceof Map ? recoveries.get(agentId) : recoveries[agentId];
  if (recovery !== undefined && !recoveryControllers.has(recovery)) {
    throw new Error(`invalid host recovery controller for ${agentId}`);
  }
  return recovery;
}

function validateSelectedAgents(intent, selectedAgents) {
  if (!Array.isArray(selectedAgents)) {
    throw new Error("selectedAgents must be an array");
  }
  const kinds = strategyKinds(intent);
  const ids = new Set();
  const byKind = new Map();
  for (const agent of selectedAgents) {
    plainObject(agent, "selected agent");
    if (typeof agent.id !== "string" || agent.id.length === 0) {
      throw new Error("selected agent id must be non-empty");
    }
    if (ids.has(agent.id)) throw new Error(`duplicate selected agent id: ${agent.id}`);
    ids.add(agent.id);
    if (typeof agent.model !== "string" || agent.model.length === 0) {
      throw new Error(`${agent.id} model must be non-empty`);
    }
    if (
      !Array.isArray(agent.handles) ||
      agent.handles.length !== 1 ||
      typeof agent.handles[0] !== "string"
    ) {
      throw new Error(`${agent.id} must handle exactly one step kind`);
    }
    const kind = agent.handles[0];
    if (!kinds.includes(kind)) {
      throw new Error(`${agent.id} handles unowned step kind: ${kind}`);
    }
    if (byKind.has(kind)) throw new Error(`multiple selected agents handle ${kind}`);
    if (typeof agent.run !== "function") {
      throw new Error(`${agent.id} has no worker function`);
    }
    byKind.set(kind, agent);
  }
  for (const kind of kinds) {
    if (!byKind.has(kind)) throw new Error(`no selected agent handles ${kind}`);
  }
  return kinds.map((kind) => byKind.get(kind));
}

function wrapAgent(agent, recoveries) {
  const recovery = selectedRecovery(recoveries, agent.id);
  return Object.freeze({
    id: agent.id,
    model: agent.model,
    handles: Object.freeze([...agent.handles]),
    async run(input) {
      const missing = input.step.deps.filter(
        (dependency) =>
          !Object.hasOwn(input.upstream, dependency) ||
          input.upstream[dependency] === undefined,
      );
      if (missing.length > 0) {
        return failureOutput("upstream-unavailable", missing);
      }

      while (true) {
        if (recovery && !recovery.acquire()) {
          return failureOutput("host-circuit-open", [agent.id]);
        }
        let raw;
        try {
          raw = await agent.run(input);
        } catch (error) {
          if (error?.code === "OXIGRAPH_CANCELLED") {
            return failureOutput("cancelled", [boundedMessage(error)]);
          }
          if (error?.code === "OXIGRAPH_PREPARATION_FAILED") {
            return failureOutput("preparation-failed", [boundedMessage(error)]);
          }
          if (error?.code === "OXIGRAPH_WORKER_OUTPUT_REJECTED") {
            // The native process completed; only its application output was
            // rejected. Release any half-open host probe without charging the
            // provider breaker or spending a retry on identical bytes.
            recovery?.recordSuccess();
            return failureOutput("worker-output-rejected", [
              error.nativeFailureCode ?? "unclassified",
            ]);
          }
          recovery?.recordFailure();
          if (recovery?.tryRetry(0)) continue;
          return failureOutput("worker-invocation-failed", [boundedMessage(error)]);
        }
        recovery?.recordSuccess();
        try {
          return normalizeWorkerOutput(raw, agent.id);
        } catch (error) {
          return failureOutput("invalid-worker-output", [boundedMessage(error)]);
        }
      }
    },
  });
}

function structuralVerifier(structuralCheck) {
  if (typeof structuralCheck !== "function") {
    throw new Error("a non-empty async structuralCheck function is required");
  }
  return Object.freeze({
    id: "oxigraph-async-structural-output",
    kind: "custom",
    async check(output, context) {
      if (isFailureOutput(output)) {
        return {
          pass: false,
          score: 0,
          reasons: output.reasons.map((reason) => `${output.code}: ${reason}`),
        };
      }
      try {
        return normalizeVerdict(
          await structuralCheck(output, context),
          "oxigraph-async-structural-output",
        );
      } catch (error) {
        return {
          pass: false,
          score: 0,
          reasons: [`structural verifier error: ${boundedMessage(error)}`],
        };
      }
    },
  });
}

function safeBudget(budget = {}) {
  plainObject(budget, "upstream budget");
  const costUsd = finiteNumber(budget.costUsd ?? 0, "budget.costUsd", { min: 0 });
  const risk = finiteNumber(budget.risk ?? 0.1, "budget.risk", {
    min: 0,
    max: 1,
  });
  const confidence = finiteNumber(
    budget.confidence ?? 1,
    "budget.confidence",
    { min: 0, max: 1 },
  );
  if (budget.retries !== undefined && budget.retries !== 0) {
    throw new Error("HarnessKernel retries must remain zero; use host recovery or repair runs");
  }
  return Object.freeze({ costUsd, risk, confidence, retries: 0 });
}

export async function runUpstreamAttempt({
  intent,
  goal,
  selectedAgents,
  structuralCheck,
  recoveries,
  budget,
  actionRisk = 0.05,
  riskCeiling = 0.1,
  runId = randomUUID(),
}) {
  const safeGoal = validateUpstreamGoal(goal, intent);
  const agents = validateSelectedAgents(intent, selectedAgents).map((agent) =>
    wrapAgent(agent, recoveries),
  );
  const policy = createAttemptPolicy(intent, { actionRisk, riskCeiling });
  const pool = new AgentPool(agents, { rng: () => 0 });
  const verifiers = new VerifierRegistry().register(
    structuralVerifier(structuralCheck),
  );
  const kernel = new HarnessKernel({
    router: new AlgorithmRouter(UPSTREAM_STRATEGIES),
    pool,
    verifiers,
    policy,
    budget: safeBudget(budget),
    breakerThreshold: 1,
    actionFor: (step, agentId) => ({
      tool: step.kind,
      args: Object.freeze({
        agentId,
        localOnly: true,
        promotionAuthority: false,
      }),
    }),
  });

  const raw = await kernel.run(safeGoal, runId);
  if (raw.receiptsValid !== true) {
    throw new Error("upstream HarnessKernel emitted an invalid receipt chain");
  }
  // AgentPool updates are deliberately process-local diagnostics. Omitting the
  // upstream poolSnapshot makes it impossible to confuse worker self-quality
  // with application-verifier routing history.
  const { poolSnapshot: _discardedPoolSnapshot, ...withoutPool } = raw;
  return deepFreeze(
    structuredClone({
      ...withoutPool,
      adapter: {
        schema: "oxigraph.metaharness-upstream-adapter/v1",
        singleUsePool: true,
        workerQualityNeutralized: true,
        poolStateAdmitted: false,
        kernelRetries: 0,
      },
    }),
  );
}
