import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createHash } from "node:crypto";
import { repository, sourceObservation } from "../src/delivery.mjs";
import { stdioHost } from "../src/workflow-host.mjs";
import { readyBatchEntries, runOrdinaryBatch } from "../src/ordinary-pool.mjs";
import { scrubbedChildEnvironment } from "../../child-environment.mjs";

const paths = ["tools/engineering-harness/README.md", "tools/engineering-harness/src/workflow-host.mjs"];
const batchSpec = () => ({ schema: 1, maxConcurrency: 2, entries: paths.map((path, index) => ({
  id: `batch-${index}`, resources: [], spec: {
    schema: 1, taskId: `task-cli-batch-${index}`, scope: "harness", goal: "Test isolated CLI composition",
    completionCheck: "Candidate checks and fixture review pass", paths: [path],
    checks: [{ completionCheck: "Policy tests pass", argv: ["node", "--test", "--test-reporter=tap",
      "tools/engineering-harness/test/workflow-policy.test.mjs"] }],
    implement: { model: "cc/claude-opus-5", effort: "high", reason: "Deterministic bridge fixture" },
    review: { model: "cc/claude-opus-5", effort: "high", reason: "Independent bridge fixture" },
  },
})) });

test("batch JSON rejects executable options, duplicates and conflicts before dispatch", async () => {
  assert.throws(() => readyBatchEntries({ ...batchSpec(), maxConcurrency: 0 }, () => {}));
  for (const alteration of [
    (batch) => { batch.entries[0].options = {}; },
    (batch) => { batch.entries[1].id = batch.entries[0].id; },
    (batch) => { batch.entries[1].spec.taskId = batch.entries[0].spec.taskId; },
    (batch) => { batch.entries[1].resources = batch.entries[0].resources = ["shared-db"]; },
  ]) {
    const batch = batchSpec(); alteration(batch); let called = false;
    await assert.rejects(async () => runOrdinaryBatch(readyBatchEntries(batch, () => {}),
      { maxConcurrency: batch.maxConcurrency }, async () => { called = true; }));
    assert.equal(called, false);
  }
});

test("bridge binds out-of-order responses to run plus request identity and rejects unknown responses", async () => {
  const directory = mkdtempSync(join(tmpdir(), "oxigraph-batch-bridge-"));
  const input = new PassThrough(), output = new PassThrough();
  const bridge = stdioHost(directory, input, output);
  try {
    const first = bridge.request({ runId: "first", requestId: 1 });
    const second = bridge.request({ runId: "second", requestId: 1 });
    input.write(JSON.stringify({ runId: "second", requestId: 1, result: 2 }) + "\n");
    input.write(JSON.stringify({ runId: "first", requestId: 1, result: 1 }) + "\n");
    assert.equal((await first).result, 1);
    assert.equal((await second).result, 2);
    const next = bridge.request({ runId: "first", requestId: 2 });
    const other = bridge.request({ runId: "second", requestId: 2 });
    const assertions = [assert.rejects(next, /Unsolicited/), assert.rejects(other, /Unsolicited/)];
    input.write(JSON.stringify({ runId: "unknown", requestId: 2 }) + "\n");
    await Promise.all(assertions);
    assert.deepEqual(bridge.close().map((request) => request.runId), ["first", "second"]);
  } finally { bridge.close(); input.destroy(); output.destroy(); rmSync(directory, { recursive: true }); }
});

test("normal batch CLI overlaps fixture authors and preserves candidate custody with real checks", { timeout: 60000 }, async (t) => {
  const before = sourceObservation();
  const canonical = paths.map((path) => readFileSync(join(repository, path), "utf8"));
  const directory = mkdtempSync(join(tmpdir(), "oxigraph-batch-cli-"));
  const specFile = join(directory, "batch.json");
  writeFileSync(specFile, JSON.stringify(batchSpec()));
  const runtimeFile = join(directory, "runtime.json");
  writeFileSync(runtimeFile, JSON.stringify({ schema: 1, memoryDirectory: `target/engineering-delivery/fixtures/${basename(directory)}` }));
  const child = spawn(process.execPath, ["tools/engineering-harness/bin/oxigraph-delivery.mjs", "batch",
    "--spec", specFile, "--runtime-config", runtimeFile, "--coordination-unavailable", "Deterministic local fixture", "--owner-review-hold", "true"],
  { cwd: repository, env: scrubbedChildEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
  t.signal.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });
  let stderr = "", output, failure;
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const authors = [], roots = new Set(), settled = [];
  const respond = (request) => {
    const { action, payload, ...identity } = request;
    let result;
    if (action === "native-worker") {
      const review = payload.route.role === "review";
      const plan = payload.route.role === "plan";
      const path = payload.files[0].path;
      const marker = path.endsWith(".md") ? "\n<!-- CLI batch fixture -->\n" : "\n// CLI batch fixture\n";
      result = { client: "deterministic-fixture", workerId: `${request.taskId}-${review ? "review" : "author"}`,
        model: payload.route.model, effort: payload.route.effort, status: "completed", verdict: "ACCEPT",
        summary: "Fixture, no model call", findings: [],
        changes: review || plan ? [] : [{ path, content: payload.files[0].content + marker }] };
    } else {
      assert.equal(action, "root-apply");
      assert.notEqual(payload.root, repository);
      roots.add(payload.root);
      for (const change of payload.changes) writeFileSync(join(payload.root, change.path), change.content);
      result = { writer: "root", applied: true, root: payload.root };
    }
    child.stdin.write(JSON.stringify({ ...identity, result }) + "\n");
  };
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (message.type === "lane-settled") {
        assert.equal(output, undefined);
        const bytes = readFileSync(message.path);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), message.sha256);
        const lane = JSON.parse(bytes);
        assert.equal(lane.id, message.id);
        assert.equal(lane.integration, "pending-owner-acceptance");
        assert.ok(readFileSync(join(lane.evidenceDirectory, "result.json")));
        settled.push(message); return;
      }
      if (message.type !== "host-request") { output = message; return; }
      const request = JSON.parse(readFileSync(message.path, "utf8"));
      if (request.action === "native-worker" && request.payload.route.role === "implement") {
        authors.push(request);
        if (authors.length === 2) authors.slice().reverse().forEach(respond);
      } else respond(request);
    } catch (error) { failure = error; child.stdin.end(); }
  });
  try {
    const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    if (failure) throw failure;
    assert.equal(code, 0, stderr);
    assert.equal(authors.length, 2);
    assert.equal(roots.size, 2);
    assert.equal(settled.length, 2);
    assert.deepEqual(output.notificationErrors, []);
    assert.equal(output.integration, "pending-owner-acceptance");
    for (const item of output.results) {
      assert.equal(item.status, "fulfilled");
      assert.ok(roots.has(item.candidateRoot));
      assert.equal(item.value.mcpReadback, false);
      assert.ok(item.value.checks.every((check) => check.status === "command-passed"));
      assert.ok(readFileSync(join(item.evidenceDirectory, "result.json"), "utf8"));
    }
    assert.deepEqual(paths.map((path) => readFileSync(join(repository, path), "utf8")), canonical);
    assert.deepEqual(sourceObservation(), before);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    lines.close(); child.stdin.end();
    rmSync(join(repository, "target/engineering-delivery/fixtures", basename(directory)), { recursive: true, force: true });
    rmSync(directory, { recursive: true });
  }
});

for (const stop of ["signal", "malformed", "eof"]) test(`batch ${stop} retains outstanding external custody`, { timeout: 60000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "oxigraph-batch-cancel-"));
  const spec = batchSpec(); spec.entries = spec.entries.slice(0, 1);
  const specFile = join(directory, "batch.json");
  writeFileSync(specFile, JSON.stringify(spec));
  const runtimeFile = join(directory, "runtime.json");
  writeFileSync(runtimeFile, JSON.stringify({ schema: 1, memoryDirectory: `target/engineering-delivery/fixtures/${basename(directory)}` }));
  const child = spawn(process.execPath, ["tools/engineering-harness/bin/oxigraph-delivery.mjs", "batch",
    "--spec", specFile, "--runtime-config", runtimeFile, "--coordination-unavailable", "Local cancellation fixture", "--owner-review-hold", "true"],
  { cwd: repository, env: scrubbedChildEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
  t.signal.addEventListener("abort", () => child.kill("SIGKILL"), { once: true });
  const lines = createInterface({ input: child.stdout });
  const actions = []; let output, failure, stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (message.type === "host-request") {
        actions.push(message.action);
        if (stop === "signal") child.kill("SIGTERM");
        else if (stop === "malformed") child.stdin.write("not-json\n");
        else child.stdin.end();
      } else output = message;
    } catch (error) { failure = error; child.stdin.end(); }
  });
  try {
    const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    if (failure) throw failure;
    assert.equal(code, 1, stderr);
    assert.deepEqual(actions, ["native-worker"]);
    assert.equal(output.ownership, "retained-until-external-actions-confirmed");
    assert.equal(output.externalActionsUnconfirmed[0].action, "native-worker");
    assert.equal(output.results[0].status, stop === "signal" ? "cancelled" : "rejected");
    assert.ok(output.results[0].candidateRoot);
    assert.ok(readFileSync(join(output.results[0].evidenceDirectory, "failure.json"), "utf8"));
    const record = JSON.parse(readFileSync(join(output.directory, "result.json"), "utf8"));
    assert.deepEqual(record.externalActionsUnconfirmed, output.externalActionsUnconfirmed);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    lines.close(); child.stdin.end();
    rmSync(join(repository, "target/engineering-delivery/fixtures", basename(directory)), { recursive: true, force: true });
    rmSync(directory, { recursive: true });
  }
});
