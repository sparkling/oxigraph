import assert from "node:assert/strict";
import test, { after } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { runOrdinaryBatch as runBatch } from "../src/ordinary-pool.mjs";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertNativeBatchProofCustody } from "./support/native-batch-proof-custody.mjs";
const custodyDirectory = mkdtempSync(join(tmpdir(), "ox-pool-custody-"));
after(() => rmSync(custodyDirectory, { recursive: true, force: true }));
const runOrdinaryBatch = (entries, options, execute) => runBatch(entries, { custodyDirectory, ...options }, execute);

const entry = (id, path) => ({ id, host: async () => ({}), resources: [], spec: {
  schema: 1, taskId: `task-${id}`, scope: "harness", goal: "Exercise ordinary callback ownership",
  completionCheck: "Checks and independent review pass", paths: [path],
  checks: [{ completionCheck: "Policy tests pass", argv: ["node", "--test", "--test-reporter=tap",
    "tools/engineering-harness/test/workflow-policy.test.mjs"] }],
} });
const pair = () => [entry("first", "tools/engineering-harness/README.md"),
  entry("second", "tools/engineering-harness/src/delivery.mjs")];

for (const reject of [false, true]) test(`release failure preserves task result and disk claim, rejected=${reject}`, async () => {
  const directory = mkdtempSync(join(tmpdir(), "ox-release-fault-"));
  try {
    const result = await runOrdinaryBatch([pair()[0]], { maxConcurrency: 1, custodyDirectory: directory }, async () => {
      const lease = join(directory, "registry.lease");
      unlinkSync(lease); mkdirSync(lease);
      if (reject) throw new Error("original task failure");
      return { candidateRoot: "/preserved", directory: "/evidence" };
    });
    assert.equal(result.results[0].status, reject ? "rejected" : "fulfilled");
    if (reject) assert.equal(result.results[0].error, "original task failure");
    else assert.equal(result.results[0].candidateRoot, "/preserved");
    assert.deepEqual(result.custodyErrors, [{ id: "first", error: "Invalid ordinary custody directory or lease" }]);
    const record = readdirSync(directory).find(name => name.endsWith(".json"));
    assert.equal(JSON.parse(readFileSync(join(directory, record), "utf8")).outcomes[0].id, "first");
    writeFileSync(join(directory, "result.json"), JSON.stringify(result));
    assert.throws(() => assertNativeBatchProofCustody({ directory, status: "ready-for-owner-review" }),
      /Native batch proof requires released durable custody/);
    rmSync(join(directory, "registry.lease"), { recursive: true });
    await assert.rejects(runOrdinaryBatch([pair()[0]], { maxConcurrency: 1, custodyDirectory: directory }, async () => ({})), /ownership conflict/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("native proof custody gate reads durable result rather than ready CLI summary", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ox-proof-custody-"));
  try {
    const result = await runOrdinaryBatch([pair()[0]], { maxConcurrency: 1 }, async () => ({}));
    writeFileSync(join(directory, "result.json"), JSON.stringify(result));
    const final = { directory, status: "ready-for-owner-review" };
    assert.deepEqual(assertNativeBatchProofCustody(final), result);
    for (const custodyErrors of [undefined, null, {}]) {
      writeFileSync(join(directory, "result.json"), JSON.stringify({ ...result, custodyErrors }));
      assert.throws(() => assertNativeBatchProofCustody(final),
        /Native batch proof requires released durable custody/);
    }
    rmSync(join(directory, "result.json"));
    assert.throws(() => assertNativeBatchProofCustody(final), /ENOENT/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("late observer rejection emits safe error after result serialization", async t => {
  const events = [];
  t.mock.method(console, "error", value => events.push(JSON.parse(value)));
  let rejectObserver;
  const observer = new Promise((_, reject) => { rejectObserver = reject; });
  const result = await runOrdinaryBatch([pair()[0]], { maxConcurrency: 1, onSettled: () => observer }, async () => ({}));
  assert.deepEqual(JSON.parse(JSON.stringify(result)).notificationErrors, []);
  rejectObserver(new Error("private exception body"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.results[0].status, "fulfilled");
  assert.deepEqual(events, [{ type: "ordinary-pool-observer-error", id: "first", error: "lane-notification-failed" }]);
});

test("independent CLI refill sees cross-process path/resource custody", async () => {
  let release, notify;
  const wait = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { notify = resolve; });
  const tasks = pair(); tasks[0].resources = ["shared-db"];
  const pending = runOrdinaryBatch(tasks, { maxConcurrency: 2, onSettled: lane => {
    if (lane.id === "second") notify();
  } }, async spec => { if (spec.taskId === "task-first") await wait; return {}; });
  try {
    await started;
    const module = new URL("../src/ordinary-custody.mjs", import.meta.url).href;
    execFileSync(process.execPath, ["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import { reserveOrdinaryCustody } from ${JSON.stringify(module)};
      const dir = ${JSON.stringify(custodyDirectory)};
      const overlap = (a,b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
      const claim = (id, paths, resources = []) => reserveOrdinaryCustody(dir, [{id,spec:{taskId:id,paths},resources}], overlap);
      assert.throws(() => claim('conflict', ['tools/engineering-harness']), /ownership conflict/);
      assert.throws(() => claim('resource', [], ['shared-db']), /ownership conflict/);
      const release = claim('refill', ['tools/engineering-harness/src/delivery.mjs']); release('refill');
    `], { stdio: 'pipe' });
  } finally { release(); await pending; }
});

test("an unfinished observer promise cannot stall pool completion or refill", { timeout: 1000 }, async () => {
  const result = await runOrdinaryBatch(pair(), { maxConcurrency: 1,
    onSettled: () => new Promise(() => {}) }, async () => ({}));
  assert.ok(result.results.every(row => row.status === 'fulfilled'));
});

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
test("settled lanes surface before slow siblings and upstream refills queued ready work", async () => {
  let release, notified;
  const slow = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { notified = resolve; });
  const events = [], starts = [];
  const tasks = [...pair(), entry("third", "tools/engineering-harness/src/workflow-host.mjs")];
  const pending = runOrdinaryBatch(tasks, { maxConcurrency: 2, onSettled: lane => {
    events.push(lane); if (lane.id === "third") notified();
  } }, async spec => {
    starts.push(spec.taskId);
    if (spec.taskId === "task-first") await slow;
    return { candidateRoot: `/candidate/${spec.taskId}`, directory: `/evidence/${spec.taskId}` };
  });
  try {
    await ready;
    assert.deepEqual(events.map(e => e.id), ["second", "third"]);
    assert.deepEqual(starts, ["task-first", "task-second", "task-third"]);
    assert.ok(events.every(e => e.integration === "pending-owner-acceptance" && e.status === "fulfilled"));
    assert.equal(events[0].candidateRoot, "/candidate/task-second");
  } finally { release(); }
  assert.deepEqual((await pending).results.map(e => e.id), ["first", "second", "third"]);
});
test("notification failures preserve rejected and cancelled evidence and final custody", async () => {
  const failure = Object.assign(new Error("workflow failed"), { candidateRoot: "/failed", evidenceDirectory: "/evidence" });
  const result = await runOrdinaryBatch([pair()[0]], { maxConcurrency: 1,
    onSettled: lane => { assert.equal(lane.status, "rejected"); throw new Error("observer failed"); } }, async () => { throw failure; });
  assert.equal(result.results[0].error, "workflow failed");
  assert.equal(result.results[0].candidateRoot, "/failed");
  assert.deepEqual(result.notificationErrors, [{ id: "first", error: "lane-notification-failed" }]);
  const controller = new AbortController(), events = [];
  const cancelled = await runOrdinaryBatch([pair()[0]], { maxConcurrency: 1, signal: controller.signal,
    onSettled: lane => events.push(lane) }, async () => {
    controller.abort(); await delay(5); return { candidateRoot: "/cancelled", directory: "/evidence" };
  });
  assert.equal(events[0].status, "cancelled");
  assert.equal(events[0].candidateRoot, "/cancelled");
  assert.equal(cancelled.results[0].status, "cancelled");
});
test("observer mutation cannot rewrite workflow result or candidate custody", async () => {
  const output = { candidateRoot: "/original", directory: "/evidence", integration: "pending-owner-acceptance",
    checks: [{ passed: true }] };
  const result = await runOrdinaryBatch([pair()[0]], { maxConcurrency: 1, onSettled: lane => {
    lane.value.candidateRoot = "/other"; lane.value.checks[0].passed = false;
    lane.value.integration = "accepted"; lane.candidateRoot = "/forged";
  } }, async () => output);
  assert.equal(result.results[0].value.candidateRoot, "/original");
  assert.equal(result.results[0].candidateRoot, "/original");
  assert.equal(result.results[0].value.checks[0].passed, true);
  assert.equal(result.results[0].value.integration, "pending-owner-acceptance");
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

test("duplicate entry or task identity rejects entire batch before dispatch", async () => {
  for (const field of ["id", "taskId"]) {
    const tasks = pair(); let calls = 0;
    if (field === "id") tasks[1].id = tasks[0].id;
    else tasks[1].spec.taskId = tasks[0].spec.taskId;
    await assert.rejects(runOrdinaryBatch(tasks, { maxConcurrency: 2 }, async () => { calls++; }), /unique entry and task identities/);
    assert.equal(calls, 0);
  }
});

test("nonfunction onSettled rejects before any executor callback", async () => {
  let calls = 0;
  await assert.rejects(
    async () => runOrdinaryBatch(pair(), { maxConcurrency: 2, onSettled: true }, async () => { calls++; }),
    /onSettled must be a callback/,
  );
  assert.equal(calls, 0);
});
