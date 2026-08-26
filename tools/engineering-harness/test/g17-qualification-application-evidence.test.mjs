import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadG17Contract } from "../src/qualification/contract.mjs";
import {
  g17AgenticProfileContract,
  inspectG17AgenticEvidence,
  runG17NativeCompatibility,
} from "../src/qualification/application-evidence.mjs";

test("G1.7 binds the owner-defined exact 11-command, 66-test Agentic profile", () => {
  const { contract } = loadG17Contract();
  assert.deepEqual(g17AgenticProfileContract(contract), {
    profile: "g1-regression",
    commandIds: contract.compatibility.agenticQe.commandIds,
    expectedCommands: 11,
    expectedPassedTests: 66,
  });
});

test("missing fixed Agentic publication is evidence-missing, not success", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-agentic-missing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { contract } = loadG17Contract();
  assert.deepEqual(
    await inspectG17AgenticEvidence({
      contract,
      identity: { subject: { commit: "a".repeat(40) } },
      evidenceRepositoryRoot: root,
      maximumGeneratedAtMs: Date.now(),
    }),
    {
      status: "MISSING",
      sha256: null,
      reasons: ["agentic-receipt-absent"],
      projection: null,
      artifacts: [],
    },
  );
});

test("native compatibility inventories and runs all exact lanes without retaining output text", async () => {
  const { contract } = loadG17Contract();
  const calls = [];
  const result = await runG17NativeCompatibility({
    contract,
    repoRoot: "/qualified/repository",
    inventory: async (id, args, policy) => {
      calls.push({ kind: "inventory", id, args, policy });
      return {
        observedTests: policy.expectedPassedTests,
        ids: Array.from(
          { length: policy.expectedPassedTests },
          (_, index) => `${id}-${index}`,
        ),
        output: {
          stdoutBytes: 1,
          stderrBytes: 0,
          stdoutSha256: "1".repeat(64),
          stderrSha256: "2".repeat(64),
        },
      };
    },
    executeCommand: async (program, args, options) => {
      calls.push({ kind: "execute", program, args, options });
      const lane = contract.compatibility.native.find(
        ({ argv }) => argv[0] === program && JSON.stringify(argv.slice(1)) === JSON.stringify(args),
      );
      return {
        code: 0,
        signal: null,
        spawnError: null,
        timedOut: false,
        timeoutMs: options.timeoutMs,
        durationMs: 12,
        observedPassedTests: lane.expectedPassedTests,
        output: {
          stdoutBytes: 10,
          stderrBytes: 0,
          stdoutSha256: "3".repeat(64),
          stderrSha256: "4".repeat(64),
        },
        stdoutTail: "secret-output-must-not-persist",
        stderrTail: "",
      };
    },
  });
  assert.equal(result.status, "PASS");
  assert.equal(result.lanes.length, 3);
  assert.deepEqual(
    result.lanes.map(({ id, observedPassedTests }) => ({ id, observedPassedTests })),
    [
      { id: "transaction-compatibility", observedPassedTests: 20 },
      { id: "bulk-sst-writer-serialization", observedPassedTests: 1 },
      { id: "update-atomicity", observedPassedTests: 2 },
    ],
  );
  assert.doesNotMatch(JSON.stringify(result), /secret-output/u);
  assert.equal(calls.length, 6);
});

test("native product failure rejects while timeout remains inconclusive", async () => {
  const { contract } = loadG17Contract();
  const inventory = async (_id, _args, policy) => ({
    observedTests: policy.expectedPassedTests,
    ids: [],
    output: {
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutSha256: "1".repeat(64),
      stderrSha256: "2".repeat(64),
    },
  });
  for (const [execution, expectedStatus] of [
    [
      {
        code: 101,
        signal: null,
        spawnError: null,
        timedOut: false,
        durationMs: 1,
        observedPassedTests: 0,
        output: {
          stdoutBytes: 0,
          stderrBytes: 1,
          stdoutSha256: "3".repeat(64),
          stderrSha256: "4".repeat(64),
        },
      },
      "FAIL",
    ],
    [
      {
        code: null,
        signal: "SIGTERM",
        spawnError: null,
        timedOut: true,
        durationMs: 300000,
        observedPassedTests: 0,
        output: {
          stdoutBytes: 0,
          stderrBytes: 0,
          stdoutSha256: "3".repeat(64),
          stderrSha256: "4".repeat(64),
        },
      },
      "MISSING",
    ],
  ]) {
    const result = await runG17NativeCompatibility({
      contract,
      inventory,
      executeCommand: async () => execution,
    });
    assert.equal(result.status, expectedStatus);
  }
});

test("application evidence module has no Router, admission, or replay authority imports", async () => {
  const source = await readFile(
    new URL("../src/qualification/application-evidence.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /RouterHistory|QualityFirstRouter|admitApplication|verifyPinnedApplication|replayApplication|applicationReceiptQuality/u,
  );
});
