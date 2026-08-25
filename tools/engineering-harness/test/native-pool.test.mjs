import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { NativeWorkerPool } from "../src/runtime/native-pool.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const contract = Object.freeze({
  routing: {
    providers: [
      { provider: "codex", transport: "native", model: "codex-model" },
      { provider: "claude", transport: "native", model: "claude-model" },
    ],
  },
  ceilings: {
    maxTotalVerifierWallMs: 30_000,
    maxWorkerOutputBytes: 64 * 1024,
  },
});

function output(role) {
  return {
    summary: `${role} complete`,
    patch: ["implementation", "repair"].includes(role)
      ? "diff --git a/source.rs b/source.rs\n--- a/source.rs\n+++ b/source.rs\n@@ -1 +1 @@\n-old\n+new\n"
      : null,
    findings: [],
    verdict: "ACCEPT",
  };
}

function result({ provider, role, model, task }) {
  const encodedTask = JSON.stringify(task);
  return {
    provider,
    role,
    model,
    status: "ACCEPT",
    output: output(role),
    invocation: {
      executable: `/native/${provider}`,
      args: ["--model", model],
      attestation: { provider, path: `/native/${provider}`, sha256: "a".repeat(64) },
      taskSha256: sha256(encodedTask),
      promptSha256: sha256(`prompt:${encodedTask}`),
    },
    outcome: {
      disposition: "completed",
      exitCode: 0,
      signal: null,
      durationMs: 7,
      stdout: "structured",
      stderr: "",
      terminationErrors: [],
    },
  };
}

test("persistent native pool freezes providers and records non-secret invocation evidence", async () => {
  const calls = [];
  const pool = new NativeWorkerPool({
    contract,
    workerRunner: async (request) => {
      calls.push(request);
      return result(request);
    },
  });
  const selected = pool.agentsFor({
    intent: "oxigraph-candidate",
    executionId: "candidate-pipeline-a",
    providersByRole: {
      architecture: "codex",
      critique: "claude",
      implementation: "codex",
    },
    taskFactory: ({ role, provider }) => ({ role, provider, localOnly: true }),
  });
  for (const agent of selected.selectedAgents) {
    const run = await agent.run({ step: { kind: agent.handles[0] }, upstream: {} });
    assert.equal(run.output.verdict, "ACCEPT");
    assert.equal(run.quality, 0);
  }
  assert.deepEqual(
    calls.map(({ provider, role }) => `${provider}:${role}`),
    ["codex:architecture", "claude:critique", "codex:implementation"],
  );
  const evidence = pool.evidence();
  assert.equal(evidence.length, 3);
  assert.equal(pool.evidenceFor("candidate-pipeline-a").length, 3);
  assert.ok(
    evidence.every(({ executionId }) => executionId === "candidate-pipeline-a"),
  );
  assert.equal(pool.evidenceFor("other-pipeline").length, 0);
  assert.ok(evidence.every(({ process }) => /^[0-9a-f]{64}$/.test(process.stdoutSha256)));
  assert.deepEqual(
    evidence.map(({ taskSha256 }) => taskSha256),
    calls.map(({ task }) => sha256(JSON.stringify(task))),
  );
  assert.deepEqual(
    evidence.map(({ promptSha256 }) => promptSha256),
    calls.map(({ task }) => sha256(`prompt:${JSON.stringify(task)}`)),
  );
  assert.ok(evidence.every((entry) => !Object.hasOwn(entry, "environment")));
  assert.equal(pool.recoverySnapshot().codex.state, "closed");
});

test("native pool rejects identity swaps before exposing worker output", async () => {
  let attempts = 0;
  const pool = new NativeWorkerPool({
    contract,
    workerRunner: async (request) => {
      attempts += 1;
      return result({ ...request, provider: "claude" });
    },
  });
  const selected = pool.agentsFor({
    intent: "oxigraph-review",
    providersByRole: { review: "codex" },
    taskFactory: () => ({ review: true }),
  });
  await assert.rejects(selected.selectedAgents[0].run({}), /changed its frozen identity/);
  assert.equal(attempts, 1, "host retry remains owned by the upstream recovery wrapper");
  assert.equal(pool.evidence().length, 1);
  assert.equal(pool.evidence()[0].status, "ERROR");
});

test("native pool preserves inconclusive spawned provenance", async () => {
  const pool = new NativeWorkerPool({
    contract,
    workerRunner: async (request) => ({
      ...result(request),
      status: "INCONCLUSIVE",
      output: undefined,
      outcome: {
        ...result(request).outcome,
        disposition: "timeout",
        exitCode: null,
        signal: "SIGKILL",
      },
    }),
  });
  const selected = pool.agentsFor({
    intent: "oxigraph-review",
    providersByRole: { review: "claude" },
    taskFactory: () => ({ review: "exact task" }),
  });
  await assert.rejects(selected.selectedAgents[0].run({}), /inconclusive/);
  const [evidence] = pool.evidence();
  assert.equal(evidence.status, "INCONCLUSIVE");
  assert.equal(evidence.executable, "/native/claude");
  assert.deepEqual(evidence.args, ["--model", "claude-model"]);
  assert.equal(evidence.executableAttestation.sha256, "a".repeat(64));
  assert.equal(evidence.taskSha256, sha256(JSON.stringify({ review: "exact task" })));
  assert.equal(evidence.promptSha256, sha256(`prompt:${JSON.stringify({ review: "exact task" })}`));
  assert.equal(evidence.process.disposition, "timeout");
  assert.equal(evidence.outputSha256, null);
});

test("native pool records task preparation ERROR with an explicit null provenance shape", async () => {
  let workerCalls = 0;
  const pool = new NativeWorkerPool({
    contract,
    workerRunner: async (request) => {
      workerCalls += 1;
      return result(request);
    },
  });
  const selected = pool.agentsFor({
    intent: "oxigraph-review",
    providersByRole: { review: "codex" },
    taskFactory: () => {
      throw new Error("sealed task preparation failed");
    },
  });
  await assert.rejects(selected.selectedAgents[0].run({}), /task preparation failed/);
  assert.equal(workerCalls, 0);
  assert.deepEqual(pool.evidence()[0], {
    sequence: 1,
    executionId: null,
    provider: "codex",
    model: "codex-model",
    role: "review",
    status: "ERROR",
    executable: null,
    args: [],
    executableAttestation: null,
    taskSha256: null,
    promptSha256: null,
    process: null,
    outputSha256: null,
    patchSha256: null,
    error: "sealed task preparation failed",
    errorSha256: sha256("sealed task preparation failed"),
  });
});

test("native pool classifies pre-spawn cancellation without calling task or provider", async () => {
  const controller = new AbortController();
  controller.abort();
  let taskCalls = 0;
  let workerCalls = 0;
  const pool = new NativeWorkerPool({
    contract,
    workerRunner: async (request) => {
      workerCalls += 1;
      return result(request);
    },
  });
  const selected = pool.agentsFor({
    intent: "oxigraph-review",
    providersByRole: { review: "codex" },
    signal: controller.signal,
    taskFactory: () => {
      taskCalls += 1;
      return { review: "never" };
    },
  });
  await assert.rejects(
    selected.selectedAgents[0].run({}),
    (error) => error.code === "OXIGRAPH_CANCELLED",
  );
  assert.equal(taskCalls, 0);
  assert.equal(workerCalls, 0);
  assert.equal(pool.evidence()[0].status, "ERROR");
  assert.equal(pool.evidence()[0].taskSha256, null);
});

test("native pool refuses OpenRouter and non-native declarations", () => {
  for (const providers of [
    [
      { provider: "codex", transport: "native", model: "openrouter/model" },
      { provider: "claude", transport: "native", model: "claude-model" },
    ],
    [
      { provider: "codex", transport: "native", model: "codex-model" },
      { provider: "claude", transport: "proxy", model: "claude-model" },
    ],
  ]) {
    assert.throws(
      () => new NativeWorkerPool({ contract: { ...contract, routing: { providers } } }),
      /OpenRouter|non-native/,
    );
  }
});
