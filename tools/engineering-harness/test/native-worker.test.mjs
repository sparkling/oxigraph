import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";
import { runNativeWorker } from "../src/native/worker.mjs";
import {
  NATIVE_WORKER_TIMEOUT_CEILINGS_MS,
  nativeWorkerTimeoutMs,
} from "../src/policy/native-timeouts.mjs";

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
  assert.match(finalPrompt, /Hunk old\/new counts must mechanically equal/);
  assert.match(finalPrompt, /blank context line is one space/);
  assert.match(finalPrompt, /Do not wrap the patch in Markdown fences/);
  assert.ok(result.invocation.args.includes("gpt-test"));
  assert.ok(/^[a-f0-9]{64}$/.test(result.invocation.attestation.sha256));
  await assert.rejects(access(outputRoot));
});

test("native patch workers admit the bounded twenty-minute ceiling", async () => {
  let observedTimeoutMs = null;
  const result = await runNativeWorker({
    provider: "codex",
    role: "implementation",
    model: "gpt-test",
    task: { id: "role-timeout" },
    contract,
    timeoutMs: 1_200_000,
    processRunner: async ({ args, timeoutMs }) => {
      observedTimeoutMs = timeoutMs;
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      await writeFile(outputPath, JSON.stringify(accepted), "utf8");
      return completed();
    },
  });
  assert.equal(observedTimeoutMs, 1_200_000);
  assert.equal(result.status, "ACCEPT");
});

test("native readonly and patch worker ceilings remain fail-closed", async () => {
  let processCalls = 0;
  for (const [role, timeoutMs] of [
    ["architecture", 600_001],
    ["critique", 600_001],
    ["review", 600_001],
    ["implementation", 1_200_001],
    ["repair", 1_200_001],
  ]) {
    await assert.rejects(
      runNativeWorker({
        provider: "codex",
        role,
        model: "gpt-test",
        task: { id: `excessive-${role}` },
        ...(role === "implementation" || role === "repair" ? { contract } : {}),
        timeoutMs,
        processRunner: async () => {
          processCalls += 1;
          return completed();
        },
      }),
      /native worker timeout must be within/u,
    );
  }
  assert.equal(processCalls, 0);
});

test("native timeout policy is frozen, aggregate-bounded, and rejects unknown roles", () => {
  assert.equal(Object.isFrozen(NATIVE_WORKER_TIMEOUT_CEILINGS_MS), true);
  assert.equal(nativeWorkerTimeoutMs("implementation", 900_000), 900_000);
  assert.equal(nativeWorkerTimeoutMs("review", 7_200_000), 600_000);
  assert.throws(
    () => nativeWorkerTimeoutMs("unknown", 7_200_000),
    /unsupported worker role/u,
  );
  assert.throws(
    () => nativeWorkerTimeoutMs("repair", 0),
    /aggregate timeout ceiling/u,
  );
});

test("native implementation admission canonicalizes mechanical diff defects", async () => {
  const mechanical = {
    ...accepted,
    patch:
      "diff --git a/lib/oxigraph/src/store.rs b/lib/oxigraph/src/store.rs\r\n" +
      "--- a/lib/oxigraph/src/store.rs\r\n" +
      "+++ b/lib/oxigraph/src/store.rs\r\n" +
      "@@ -1,9 +1,2 @@\r\n" +
      " context\r\n" +
      "\r\n" +
      "-old\r\n" +
      "+new\r\n",
  };
  const result = await runNativeWorker({
    provider: "codex",
    role: "implementation",
    model: "gpt-test",
    task: { id: "mechanical-diff-repair" },
    contract,
    processRunner: async ({ args }) => {
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      await writeFile(outputPath, JSON.stringify(mechanical), "utf8");
      return completed();
    },
  });
  assert.equal(result.status, "ACCEPT");
  assert.equal(
    result.output.patch,
    "diff --git a/lib/oxigraph/src/store.rs b/lib/oxigraph/src/store.rs\n" +
      "--- a/lib/oxigraph/src/store.rs\n" +
      "+++ b/lib/oxigraph/src/store.rs\n" +
      "@@ -1,3 +1,3 @@\n" +
      " context\n" +
      " \n" +
      "-old\n" +
      "+new\n",
  );
});

test("native patch admission requires the exact canonical bytes to pass Git's parser", async () => {
  const gitRejected = {
    ...accepted,
    patch: accepted.patch.replace("+new\n", "+new \n"),
  };
  const result = await runNativeWorker({
    provider: "codex",
    role: "implementation",
    model: "gpt-test",
    task: { id: "git-parser-rejection" },
    contract,
    processRunner: async ({ args }) => {
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      await writeFile(outputPath, JSON.stringify(gitRejected), "utf8");
      return completed();
    },
  });
  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.failure.code, "patch-policy-invalid");
  assert.match(result.failure.detailSha256, /^[a-f0-9]{64}$/);
});

test("native patch admission gives the parser the canonical bytes before acceptance", async () => {
  let parsedPatch = null;
  const result = await runNativeWorker({
    provider: "codex",
    role: "implementation",
    model: "gpt-test",
    task: { id: "git-parser-exact-bytes" },
    contract,
    processRunner: async ({ args }) => {
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      await writeFile(outputPath, JSON.stringify(accepted), "utf8");
      return completed();
    },
    patchParser: async ({ patch }) => {
      parsedPatch = patch;
    },
  });
  assert.equal(result.status, "ACCEPT");
  assert.equal(parsedPatch, accepted.patch);
  assert.equal(result.output.patch, parsedPatch);
});

test("native implementation admission applies the contract ceiling to raw bytes", async () => {
  const rawPatch = accepted.patch.replaceAll("\n", "\r\n");
  const tightContract = {
    ...contract,
    ceilings: {
      ...contract.ceilings,
      maxPatchBytes: Buffer.byteLength(accepted.patch),
    },
  };
  const result = await runNativeWorker({
    provider: "codex",
    role: "implementation",
    model: "gpt-test",
    task: { id: "raw-byte-ceiling" },
    contract: tightContract,
    processRunner: async ({ args }) => {
      const outputPath = args[args.indexOf("--output-last-message") + 1];
      await writeFile(
        outputPath,
        JSON.stringify({ ...accepted, patch: rawPatch }),
        "utf8",
      );
      return completed();
    },
  });
  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.failure.code, "patch-policy-invalid");
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
  assert.equal(result.failure.code, "process-nonzero");
  assert.equal(result.failure.retryable, true);
  assert.match(result.failure.detailSha256, /^[a-f0-9]{64}$/);
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

test("native Claude worker admits only the unique terminal result from array envelopes", async () => {
  const output = { ...accepted, patch: null };
  const result = await runNativeWorker({
    provider: "claude",
    role: "review",
    model: "claude-test",
    task: { id: "array-envelope", sourceSnapshot: "old" },
    processRunner: async () =>
      completed(
        JSON.stringify([
          { type: "system", subtype: "init" },
          { type: "assistant", message: {} },
          { type: "result", subtype: "success", structured_output: output },
        ]),
      ),
  });
  assert.equal(result.status, "ACCEPT");
  assert.equal(result.output.patch, null);

  for (const malformed of [
    [],
    [{ type: "result", structured_output: output }, { type: "system" }],
    [
      { type: "result", structured_output: output },
      { type: "result", structured_output: output },
    ],
  ]) {
    const rejected = await runNativeWorker({
      provider: "claude",
      role: "review",
      model: "claude-test",
      task: { id: "invalid-array-envelope", sourceSnapshot: "old" },
      processRunner: async () => completed(JSON.stringify(malformed)),
    });
    assert.equal(rejected.status, "INCONCLUSIVE");
    assert.equal(rejected.output, undefined);
    assert.equal(rejected.failure.code, "provider-envelope-invalid");
    assert.equal(rejected.failure.retryable, false);
  }
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
  assert.equal(inconclusive.failure.code, "patch-policy-invalid");
  assert.equal(inconclusive.failure.retryable, false);
  assert.ok(inconclusive.invocation.executable.startsWith("/"));
  assert.ok(/^[a-f0-9]{64}$/.test(inconclusive.invocation.taskSha256));
  assert.ok(/^[a-f0-9]{64}$/.test(inconclusive.invocation.promptSha256));
});

test("native worker exposes only bounded output-admission failure classes", async () => {
  const cases = [
    {
      code: "output-missing",
      write: async () => {},
    },
    {
      code: "worker-json-invalid",
      write: async (path) => writeFile(path, "{", "utf8"),
    },
    {
      code: "role-contract-invalid",
      write: async (path) =>
        writeFile(
          path,
          JSON.stringify({ ...accepted, patch: null, unexpected: true }),
          "utf8",
        ),
    },
  ];
  for (const fixture of cases) {
    const result = await runNativeWorker({
      provider: "codex",
      role: "review",
      model: "gpt-test",
      task: { id: fixture.code },
      processRunner: async ({ args }) => {
        await fixture.write(args[args.indexOf("--output-last-message") + 1]);
        return completed();
      },
    });
    assert.equal(result.status, "INCONCLUSIVE");
    assert.deepEqual(Object.keys(result.failure).sort(), [
      "code",
      "detailSha256",
      "retryable",
    ]);
    assert.equal(result.failure.code, fixture.code);
    assert.equal(result.failure.retryable, false);
    assert.match(result.failure.detailSha256, /^[a-f0-9]{64}$/);
  }

  const declined = await runNativeWorker({
    provider: "claude",
    role: "architecture",
    model: "claude-test",
    task: { id: "semantic-decline" },
    processRunner: async () =>
      completed(
        JSON.stringify({
          structured_output: {
            summary: "insufficient evidence",
            patch: null,
            findings: [],
            verdict: "INCONCLUSIVE",
          },
        }),
      ),
  });
  assert.equal(declined.status, "INCONCLUSIVE");
  assert.equal(declined.failure.code, "worker-declined");
  assert.equal(declined.failure.retryable, false);
});
