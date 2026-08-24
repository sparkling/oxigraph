import assert from "node:assert/strict";
import test from "node:test";
import {
  createAttemptPolicy,
  createHostRecovery,
  runUpstreamAttempt,
} from "../src/runtime/upstream.mjs";

function output(role, { quality = 0.91 } = {}) {
  return {
    output: { role, value: `${role}-output` },
    quality,
    confidence: 1,
    risk: 0,
    costUsd: 0,
    latencyMs: 1,
  };
}

function agent(role, calls, options = {}) {
  return {
    id: options.id ?? `codex:${role}`,
    model: options.model ?? "test-native-model",
    handles: [role],
    async run(input) {
      calls.push({ role, upstream: structuredClone(input.upstream) });
      if (options.error) throw options.error;
      return options.output ?? output(role, options);
    },
  };
}

function candidateAgents(calls, overrides = {}) {
  return ["architecture", "critique", "implementation"].map(
    (role) => overrides[role] ?? agent(role, calls),
  );
}

const passesMatchingRole = async (value, context) => {
  await Promise.resolve();
  return {
    pass: value.role === context.step.kind,
    score: value.role === context.step.kind ? 1 : 0,
    reasons: value.role === context.step.kind ? [] : ["role mismatch"],
  };
};

test("real AlgorithmRouter and HarnessKernel execute the frozen candidate DAG", async () => {
  const calls = [];
  const run = await runUpstreamAttempt({
    intent: "oxigraph-candidate",
    goal: { text: "implement G1.1", context: { task: { id: "G1.1" } } },
    selectedAgents: candidateAgents(calls),
    structuralCheck: passesMatchingRole,
    runId: "candidate-integration",
  });

  assert.equal(run.classification.intent, "oxigraph-candidate");
  assert.deepEqual(
    run.steps.map(({ step }) => step.id),
    [
      "oxigraph-candidate:architecture",
      "oxigraph-candidate:critique",
      "oxigraph-candidate:implementation",
    ],
  );
  assert.deepEqual(
    calls.map(({ role }) => role),
    ["architecture", "critique", "implementation"],
  );
  assert.deepEqual(Object.keys(calls[1].upstream), [
    "oxigraph-candidate:architecture",
  ]);
  assert.deepEqual(Object.keys(calls[2].upstream), [
    "oxigraph-candidate:critique",
  ]);
  assert.equal(run.success, true);
  assert.equal(run.receiptsValid, true);
  assert.equal(run.receipts.length, 3);
  assert.equal(run.adapter.singleUsePool, true);
  assert.equal(run.adapter.kernelRetries, 0);
});

test("adapter refuses an empty verifier instead of accepting upstream's empty registry", async () => {
  const calls = [];
  await assert.rejects(
    runUpstreamAttempt({
      intent: "oxigraph-review",
      goal: { text: "review" },
      selectedAgents: [agent("review", calls)],
    }),
    /non-empty async structuralCheck/,
  );
  assert.deepEqual(calls, []);
});

test("adapter awaits its explicit async verifier instead of using async predicateVerifier", async () => {
  const calls = [];
  let checked = false;
  const run = await runUpstreamAttempt({
    intent: "oxigraph-review",
    goal: { text: "review" },
    selectedAgents: [agent("review", calls)],
    structuralCheck: async () => {
      await Promise.resolve();
      checked = true;
      return false;
    },
    runId: "async-verifier-rejection",
  });
  assert.equal(checked, true);
  assert.equal(run.success, false);
  assert.equal(run.steps[0].verdict.pass, false);
  assert.equal(calls.length, 1);
});

test("adapter neutralizes worker self-quality and never exposes pool state as routing history", async () => {
  const calls = [];
  const run = await runUpstreamAttempt({
    intent: "oxigraph-review",
    goal: { text: "review" },
    selectedAgents: [agent("review", calls, { quality: 0.99 })],
    structuralCheck: passesMatchingRole,
    runId: "pool-state-discarded",
  });
  assert.equal(run.steps[0].output.quality, 0);
  assert.equal(Object.hasOwn(run, "poolSnapshot"), false);
  assert.equal(run.adapter.workerQualityNeutralized, true);
  assert.equal(run.adapter.poolStateAdmitted, false);
});

test("failed upstream output suppresses every dependent native worker", async () => {
  const calls = [];
  const run = await runUpstreamAttempt({
    intent: "oxigraph-candidate",
    goal: { text: "implement G1.1" },
    selectedAgents: candidateAgents(calls),
    structuralCheck: async (value, context) =>
      context.step.kind === "architecture"
        ? { pass: false, score: 0, reasons: ["bad architecture"] }
        : passesMatchingRole(value, context),
    runId: "dependency-suppression",
  });
  assert.equal(run.success, false);
  assert.deepEqual(
    calls.map(({ role }) => role),
    ["architecture"],
  );
  assert.match(run.steps[1].verdict.reasons.join(" "), /upstream-unavailable/);
  assert.match(run.steps[2].verdict.reasons.join(" "), /upstream-unavailable/);
});

test("review and repair use separate real AlgorithmRouter strategies", async () => {
  for (const [intent, role] of [
    ["oxigraph-review", "review"],
    ["oxigraph-repair", "repair"],
  ]) {
    const calls = [];
    const run = await runUpstreamAttempt({
      intent,
      goal: { text: role },
      selectedAgents: [agent(role, calls)],
      structuralCheck: passesMatchingRole,
      runId: `${role}-integration`,
    });
    assert.equal(run.success, true);
    assert.equal(run.steps[0].step.id, `${intent}:${role}`);
    assert.deepEqual(calls.map(({ role: called }) => called), [role]);
  }
});

test("goal context cannot replace the real goal or step supplied to verifiers", async () => {
  for (const reserved of ["goal", "step"]) {
    await assert.rejects(
      runUpstreamAttempt({
        intent: "oxigraph-review",
        goal: { text: "review", context: { [reserved]: "forged" } },
        selectedAgents: [agent("review", [])],
        structuralCheck: passesMatchingRole,
      }),
      new RegExp(`may not override ${reserved}`),
    );
  }
});

test("real PolicyGate remains explicit default-deny outside the frozen strategy", () => {
  const policy = createAttemptPolicy("oxigraph-candidate");
  assert.equal(policy.evaluate({ tool: "architecture" }).allow, true);
  const denied = policy.evaluate({ tool: "publish" });
  assert.equal(denied.allow, false);
  assert.match(denied.reasons.join(" "), /default-deny/);
});

test("real CircuitBreaker and RetryBudget back bounded same-host recovery", () => {
  let now = 0;
  const recovery = createHostRecovery({
    threshold: 2,
    cooldownMs: 100,
    maxRetries: 1,
    maxRetryUsd: 0,
    now: () => now,
  });
  assert.equal(recovery.acquire(), true);
  recovery.recordFailure();
  assert.equal(recovery.tryRetry(0), true);
  assert.equal(recovery.tryRetry(0), false);
  assert.equal(recovery.acquire(), true);
  recovery.recordFailure();
  assert.equal(recovery.snapshot().state, "open");
  assert.equal(recovery.acquire(), false);
  now = 100;
  assert.equal(recovery.acquire(), true);
  assert.equal(recovery.acquire(), false, "only one half-open trial is admitted");
  recovery.recordSuccess();
  assert.equal(recovery.snapshot().state, "closed");
});

test("host recovery retries only the same selected agent while kernel retries stay zero", async () => {
  const calls = [];
  let attempts = 0;
  const selected = agent("review", calls, { id: "claude:review" });
  selected.run = async (input) => {
    calls.push({ role: "review", upstream: structuredClone(input.upstream) });
    attempts += 1;
    if (attempts === 1) throw new Error("transient host failure");
    return output("review");
  };
  const recovery = createHostRecovery({
    threshold: 2,
    cooldownMs: 100,
    maxRetries: 1,
  });
  const run = await runUpstreamAttempt({
    intent: "oxigraph-review",
    goal: { text: "review" },
    selectedAgents: [selected],
    recoveries: new Map([[selected.id, recovery]]),
    structuralCheck: passesMatchingRole,
    runId: "same-host-retry",
  });
  assert.equal(run.success, true);
  assert.equal(attempts, 2);
  assert.equal(recovery.snapshot().retriesRemaining, 0);
  assert.equal(run.steps[0].attempts, 0, "HarnessKernel itself did not retry");
});
