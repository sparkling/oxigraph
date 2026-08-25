import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";
import { runNativeWorker } from "../src/native/worker.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const accepted = Object.freeze({
  summary: "bounded candidate",
  patch: "diff --git a/lib/oxigraph/src/store.rs b/lib/oxigraph/src/store.rs\n--- a/lib/oxigraph/src/store.rs\n+++ b/lib/oxigraph/src/store.rs\n@@ -1 +1 @@\n-old\n+new\n",
  findings: [],
  verdict: "ACCEPT",
});

const contract = Object.freeze({
  evaluatorPath: "lib/oxigraph/tests/transaction_concurrency.rs",
  mutableExact: ["lib/oxigraph/src/store.rs"],
  ceilings: {
    maxPatchBytes: 4096,
    maxChangedFiles: 1,
    maxChangedLines: 8,
  },
});

function completed(stdout = "") {
  return Object.freeze({
    exitCode: 0,
    signal: null,
    disposition: "completed",
    stdout,
    stderr: "",
    durationMs: 1,
  });
}

test("native Codex worker consumes structured output and removes its private output directory", async () => {
  let outputRoot;
  let finalPrompt;
  const task = { id: "test", sourceSnapshot: "old" };
  const result = await runNativeWorker({
    provider: "codex",
    role: "implementation",
    model: "gpt-test",
    task,
    contract,
    processRunner: async ({ args, stdin }) => {
      finalPrompt = stdin;
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      outputRoot = dirname(outputPath);
      await writeFile(outputPath, JSON.stringify(accepted), "utf8");
      return completed();
    },
  });
  assert.equal(result.status, "ACCEPT");
  assert.equal(result.output.patch, accepted.patch);
  assert.equal(result.invocation.taskSha256, sha256(Buffer.from(JSON.stringify(task), "utf8")));
  assert.equal(result.invocation.promptSha256, sha256(Buffer.from(finalPrompt, "utf8")));
  assert.ok(result.invocation.args.includes("gpt-test"));
  assert.ok(/^[a-f0-9]{64}$/.test(result.invocation.attestation.sha256));
  await assert.rejects(access(outputRoot));
});

test("inconclusive native invocation retains executable, args, attestation, and exact byte digests", async () => {
  let finalPrompt;
  const task = Object.freeze({ id: "inconclusive", sourceSnapshot: "exact bytes: ä" });
  const outcome = Object.freeze({
    exitCode: 17,
    signal: null,
    disposition: "completed",
    stdout: "",
    stderr: "provider failure",
    durationMs: 3,
    terminationErrors: Object.freeze([]),
  });
  const result = await runNativeWorker({
    provider: "claude",
    role: "review",
    model: "claude-test",
    task,
    processRunner: async ({ stdin }) => {
      finalPrompt = stdin;
      return outcome;
    },
  });
  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.outcome, outcome);
  assert.equal(result.invocation.taskSha256, sha256(Buffer.from(JSON.stringify(task), "utf8")));
  assert.equal(result.invocation.promptSha256, sha256(Buffer.from(finalPrompt, "utf8")));
  assert.ok(result.invocation.executable.startsWith("/"));
  assert.ok(result.invocation.args.includes("claude-test"));
  assert.ok(/^[a-f0-9]{64}$/.test(result.invocation.attestation.sha256));
});

test("an already-aborted native task never reaches the provider process", async () => {
  const controller = new AbortController();
  controller.abort();
  let processCalls = 0;
  await assert.rejects(
    runNativeWorker({
      provider: "codex",
      role: "review",
      model: "gpt-test",
      task: { id: "cancelled" },
      signal: controller.signal,
      processRunner: async () => {
        processCalls += 1;
        return completed();
      },
    }),
    (error) => error.code === "OXIGRAPH_CANCELLED",
  );
  assert.equal(processCalls, 0);
});

test("native Claude worker decodes schema output and rejects unsupported providers", async () => {
  const output = { ...accepted, patch: null };
  const result = await runNativeWorker({
    provider: "claude",
    role: "review",
    model: "claude-test",
    task: { id: "test", sourceSnapshot: "old" },
    processRunner: async () => completed(JSON.stringify({ structured_output: output })),
  });
  assert.equal(result.status, "ACCEPT");
  assert.equal(result.output.patch, null);
  await assert.rejects(
    runNativeWorker({
      provider: "unknown",
      role: "review",
      model: "test",
      task: { id: "test" },
    }),
    /unsupported native provider/,
  );
});

test("native worker validates role and candidate paths before admitting output", async () => {
  let called = false;
  await assert.rejects(
    runNativeWorker({
      provider: "codex",
      role: "sovereign-writer",
      model: "gpt-test",
      task: { id: "test" },
      processRunner: async () => {
        called = true;
        return completed();
      },
    }),
    /unsupported worker role/,
  );
  assert.equal(called, false);

  const protectedOutput = {
    ...accepted,
    patch: "diff --git a/Cargo.toml b/Cargo.toml\n--- a/Cargo.toml\n+++ b/Cargo.toml\n@@ -1 +1 @@\n-old\n+new\n",
  };
  const inconclusive = await runNativeWorker({
    provider: "codex",
    role: "implementation",
    model: "gpt-test",
    task: { id: "test", sourceSnapshot: "old" },
    contract,
    processRunner: async ({ args }) => {
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      await writeFile(outputPath, JSON.stringify(protectedOutput), "utf8");
      return completed();
    },
  });
  assert.equal(inconclusive.status, "INCONCLUSIVE");
  assert.equal(inconclusive.output, undefined);
  assert.ok(inconclusive.invocation.executable.startsWith("/"));
  assert.ok(/^[a-f0-9]{64}$/.test(inconclusive.invocation.taskSha256));
  assert.ok(/^[a-f0-9]{64}$/.test(inconclusive.invocation.promptSha256));
});
