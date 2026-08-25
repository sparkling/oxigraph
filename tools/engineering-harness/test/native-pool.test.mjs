import assert from "node:assert/strict";
import test from "node:test";
import { NativeWorkerPool } from "../src/runtime/native-pool.mjs";

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

function result({ provider, role, model }) {
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
  assert.ok(evidence.every(({ process }) => /^[0-9a-f]{64}$/.test(process.stdoutSha256)));
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
