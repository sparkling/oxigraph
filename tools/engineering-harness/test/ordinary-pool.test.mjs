import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { runOrdinaryBatch } from "../src/ordinary-pool.mjs";

const entry = (id, path) => ({ id, host: async () => ({}), resources: [], spec: {
  schema: 1, taskId: `task-${id}`, scope: "harness", goal: "Exercise ordinary callback ownership",
  completionCheck: "Checks and independent review pass", paths: [path],
  checks: [{ completionCheck: "Policy tests pass", argv: ["node", "--test", "--test-reporter=tap",
    "tools/engineering-harness/test/workflow-policy.test.mjs"] }],
} });
const pair = () => [entry("first", "tools/engineering-harness/README.md"),
  entry("second", "tools/engineering-harness/src/delivery.mjs")];

test("actual upstream pool bounds overlapping callbacks and preserves input order", async () => {
  let active = 0, peak = 0;
  const result = await runOrdinaryBatch(pair(), { maxConcurrency: 2 }, async (spec) => {
    active++; peak = Math.max(active, peak);
    await delay(spec.taskId === "task-first" ? 20 : 5);
    active--; return { taskId: spec.taskId, integration: "pending-owner-acceptance" };
  });
  assert.equal(peak, 2);
  assert.equal(result.peakConcurrency, 2);
  assert.deepEqual(result.results.map((item) => item.id), ["first", "second"]);
  assert.ok(result.results.every((item) => item.status === "fulfilled"));
  assert.equal(result.integration, "pending-owner-acceptance");
});
test("same source or named resource conflict rejects entire batch before dispatch", async () => {
  for (const kind of ["source", "resource"]) {
    const tasks = pair(); let calls = 0;
    if (kind === "source") tasks[1].spec.paths = tasks[0].spec.paths;
    else tasks.forEach((task) => { task.resources = ["shared-db"]; });
    await assert.rejects(runOrdinaryBatch(tasks, { maxConcurrency: 2 }, async () => { calls++; }), /ownership conflict/);
    assert.equal(calls, 0);
  }
});
test("pre-aborted signal never reaches upstream callback", async () => {
  const controller = new AbortController(); controller.abort(new Error("already stopped"));
  let calls = 0;
  await assert.rejects(runOrdinaryBatch(pair(), { maxConcurrency: 2, signal: controller.signal }, async () => { calls++; }), /already stopped/);
  assert.equal(calls, 0);
});
test("cancelled pool retains ownership until noncooperative started work settles", async () => {
  const controller = new AbortController(); let settled = false, started = 0;
  const result = await runOrdinaryBatch(pair(), { maxConcurrency: 1, signal: controller.signal }, async () => {
    started++; controller.abort(new Error("stop queued work"));
    await delay(30); settled = true;
  });
  assert.equal(started, 1);
  assert.equal(settled, true);
  assert.ok(result.results.every((item) => item.status === "cancelled"));
  assert.ok(result.durationMs >= result.poolDurationMs);
});

test("failed and cancelled candidates retain custody pointers without changing pool status", async () => {
  const failed = await runOrdinaryBatch([pair()[0]], { maxConcurrency: 1 }, async () => {
    throw Object.assign(new Error("check failed"), {
      candidateRoot: "/candidate/failed", evidenceDirectory: "/candidate/failed/evidence",
    });
  });
  assert.equal(failed.results[0].status, "rejected");
  assert.equal(failed.results[0].candidateRoot, "/candidate/failed");
  assert.equal(failed.results[0].evidenceDirectory, "/candidate/failed/evidence");
  const controller = new AbortController();
  const cancelled = await runOrdinaryBatch([pair()[0]], { maxConcurrency: 1, signal: controller.signal }, async () => {
    controller.abort();
    await delay(5);
    return { candidateRoot: "/candidate/cancelled", directory: "/candidate/cancelled/evidence" };
  });
  assert.equal(cancelled.results[0].status, "cancelled");
  assert.equal(cancelled.results[0].candidateRoot, "/candidate/cancelled");
  assert.equal(cancelled.results[0].evidenceDirectory, "/candidate/cancelled/evidence");
});
