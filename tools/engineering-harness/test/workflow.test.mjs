import assert from "node:assert/strict";
import test from "node:test";
import { checkFeedback, digest, runWorkflow, validateWorkflow } from "../src/workflow.mjs";
import { admitCommand } from "../src/delivery.mjs";
import { stdioHost } from "../src/workflow-host.mjs";
import { PassThrough, Writable } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const path = "tools/engineering-harness/src/workflow-host.mjs";
const spec = {
  schema: 1, taskId: "task-workflow-test", scope: "harness", goal: "Implement the declared harness change",
  completionCheck: "Exact source passes independent review and native assertions",
  paths: [path], checks: [{ completionCheck: "Focused tests pass", argv: ["node", "--test", "--test-reporter=tap", "tools/engineering-harness/test/workflow.test.mjs"] }],
};
function fixture(options = {}) {
  let content = "before";
  let outside = "unchanged";
  let checks = 0;
  let implementations = 0;
  let reviews = 0;
  const actions = [];
  const feedback = [];
  const observe = () => ({ head: "a".repeat(40), branch: "main", trackedDiffSha256: digest(content), untracked: [] });
  const io = {
    observe,
    outside: () => outside,
    files: () => [{ path, sha256: options.sha ? options.sha(content) : null, content }],
    execute: async (check) => {
      checks++;
      const source = observe();
      const failed = options.failChecks === true || checks <= (options.failChecks ?? 0);
      const run = { taskId: spec.taskId, source, sourceAfter: source, sourceStable: true,
        command: admitCommand(check.argv), plan: { completionCheck: check.completionCheck },
        status: failed ? "failed" : "command-passed", result: { passed: !failed, code: failed ? 1 : 0, durationMs: checks * 10 }, failure: failed ? "real check failure" : null };
      if (options.checkDrift) content += "drift";
      if (options.staleCheck) run.source = { wrong: true };
      return run;
    },
  };
  const host = async (request) => {
    actions.push(request.action);
    let result;
    if (request.action === "mcp-read") {
      result = { task: { taskId: spec.taskId, status: "in_progress" }, control: {
        activeHarnessTaskId: spec.taskId, activeDeliveryTaskId: spec.taskId, ownerReviewHold: { active: options.hold ?? true },
      } };
      if (options.missingTask) result.task = null;
    } else if (request.action === "native-worker") {
      const { route } = request.payload;
      const review = route.role === "review";
      if (review) reviews++; else { implementations++; feedback.push(request.payload.feedback); }
      result = { client: "test-double", workerId: review && !options.sameWorker ? `review-${reviews}` : "implementation", model: route.model,
        effort: route.effort, status: "completed", summary: "fixture result", verdict: "ACCEPT", findings: [], changes: [] };
      if (!review) result.changes = options.noChanges ? [] : [{ path, content: options.stalled ? "after" : `after-${implementations}` }];
      if (!review && options.badPath) result.changes[0].path = options.badPath;
      if (review && reviews <= (options.rejectReviews ?? 0)) { result.verdict = "REJECT"; result.findings = ["Fix the exact review finding"]; }
      if (review && options.reviewWrites) content += "unexpected review edit";
      if (options.unavailable) result = { client: "Codex native collaboration", model: route.model, effort: route.effort, status: "unavailable", error: "fixture: requested model unavailable" };
      if (options.proposalDrift) content += "concurrent edit";
    } else if (request.action === "root-apply") {
      content = request.payload.changes[0].content;
      if (options.outsideWrite) outside = "changed";
      result = { writer: options.wrongWriter ? "worker" : "root", applied: true };
    } else if (request.action === "mcp-handoff") {
      result = { value: options.badReadback ? { stale: true } : request.payload.evidence };
    } else throw new Error(`unexpected fixture action ${request.action}`);
    const { action, payload, ...identity } = request;
    return { ...identity, ...(options.crossTask ? { taskId: "task-other" } : {}), result };
  };
  return { io, host, actions, feedback, counters: () => ({ checks, implementations, reviews }) };
}
// Match real file digests while keeping these controller tests filesystem-free.
import { createHash } from "node:crypto";
const sha = (value) => createHash("sha256").update(value).digest("hex");
function setup(options) { return fixture({ sha, ...options }); }

test("workflow executes native edit, apply, deterministic check, independent review and exact MCP handoff", async () => {
  const f = setup();
  const result = await runWorkflow(spec, f.host, f.io);
  assert.equal(result.status, "ready-for-owner-review");
  assert.equal(result.mcpReadback, true);
  assert.equal(result.qualification, false);
  assert.equal(result.publication, false);
  assert.equal(result.review.kernelReceiptsValid, true);
  assert.deepEqual(f.counters(), { checks: 1, implementations: 1, reviews: 1 });
  assert.deepEqual(f.actions.filter((action) => action !== "mcp-read"), ["native-worker", "root-apply", "native-worker", "mcp-handoff"]);
});
test("source identity is canonical and does not depend on record key insertion order", () => {
  assert.equal(digest([{ path, sha256: "a", content: "b" }]), digest([{ content: "b", path, sha256: "a" }]));
  assert.notEqual(digest([{ path, sha256: "a", content: "b" }]), digest([{ content: "c", path, sha256: "a" }]));
});
test("failed check reaches repair verbatim, stops later checks/review, and repaired source is checked again", async () => {
  const f = setup({ failChecks: 1 });
  const result = await runWorkflow({ ...spec, checks: [spec.checks[0], spec.checks[0]] }, f.host, f.io);
  assert.equal(result.status, "ready-for-owner-review");
  assert.deepEqual(f.counters(), { checks: 3, implementations: 2, reviews: 1 });
  assert.equal(f.feedback[1].code, 1);
  assert.match(f.feedback[1].resultSha256, /^[a-f0-9]{64}$/);
});
test("independent review findings feed repair and force a fresh check and review", async () => {
  const f = setup({ rejectReviews: 1 });
  await runWorkflow(spec, f.host, f.io);
  assert.deepEqual(f.counters(), { checks: 2, implementations: 2, reviews: 2 });
  assert.deepEqual(f.feedback[1].review.findings, ["Fix the exact review finding"]);
});
test("unchanged failing repairs stop for integrator judgment, not an invocation quota", async () => {
  const f = setup({ failChecks: true, stalled: true });
  await assert.rejects(runWorkflow(spec, f.host, f.io), /Repair stalled/);
  assert.equal(f.counters().reviews, 0);
  assert.ok(!f.actions.includes("mcp-handoff"));
});
test("owner hold prevents product workers and commands, but permits harness-only repair", async () => {
  const f = setup({ hold: true });
  await assert.rejects(runWorkflow({ ...spec, scope: "product", paths: ["lib/oxigraph/src/store.rs"] }, f.host, f.io), /Owner review hold/);
  assert.deepEqual(f.actions, ["mcp-read"]);
  assert.equal(f.counters().checks, 0);
});
test("missing live task, cross-task response and stale native source fail before apply", async () => {
  for (const options of [{ missingTask: true }, { crossTask: true }, { proposalDrift: true }]) {
    const f = setup(options);
    await assert.rejects(runWorkflow(spec, f.host, f.io));
    assert.ok(!f.actions.includes("root-apply"));
  }
});
test("protected/out-of-scope patches and non-root application cannot proceed", async () => {
  for (const options of [{ badPath: "AGENTS.md" }, { badPath: ".swarm/state" }, { wrongWriter: true }, { outsideWrite: true }]) {
    const f = setup(options);
    await assert.rejects(runWorkflow(spec, f.host, f.io));
    assert.equal(f.counters().checks, 0);
  }
});
test("stale command evidence and source changes during checks/review prevent handoff", async () => {
  for (const options of [{ staleCheck: true }, { checkDrift: true }, { reviewWrites: true }]) {
    const f = setup(options);
    await assert.rejects(runWorkflow(spec, f.host, f.io));
    assert.ok(!f.actions.includes("mcp-handoff"));
  }
});
test("reviewer must be distinct, MCP readback must match, and no-op cannot complete", async () => {
  for (const options of [{ sameWorker: true }, { badReadback: true }, { noChanges: true }]) {
    const f = setup(options);
    await assert.rejects(runWorkflow(spec, f.host, f.io));
  }
});
test("native unavailability reports exact client/model/error without substitution or repair", async () => {
  const f = setup({ unavailable: true });
  await assert.rejects(runWorkflow(spec, f.host, f.io), /Codex native collaboration; model=gpt-5.6-terra; fixture: requested model unavailable/);
  assert.equal(f.counters().implementations, 1);
  assert.equal(f.counters().checks, 0);
});
test("task contracts reject unknown fields, protected paths and product commands in harness scope", () => {
  for (const invalid of [{ ...spec, provider: "other" }, { ...spec, paths: [".claude-flow/state"] },
    { ...spec, paths: ["tools/engineering-harness/src/runtime/upstream.mjs"] },
    { ...spec, paths: ["tools/engineering-harness/src/../src/workflow.mjs"] },
    { ...spec, checks: [{ completionCheck: "invalid", argv: ["cargo", "test", "--locked", "-p", "oxigraph"] }] }]) {
    assert.throws(() => validateWorkflow(invalid));
  }
});
test("worker failure projection keeps raw process text local and bounds spec size", () => {
  const raw = { status: "failed", directory: "/local/run", result: { code: 1, stderrTail: "private output must remain local", output: "x".repeat(100000) } };
  const feedback = checkFeedback(raw);
  assert.equal(feedback.resultSha256, digest(raw));
  assert.equal(JSON.stringify(feedback).includes("private output"), false);
  assert.ok(JSON.stringify(feedback).length < 2048);
  assert.throws(() => validateWorkflow({ ...spec, goal: "x".repeat(32768) }), /structural limit/);
});
test("check feedback uses the native test framework count, not an unrelated zero counter", () => {
  const result = { observedPassedTests: 0, observedNodeTestSummary: { pass: 27, fail: 0 } };
  assert.equal(checkFeedback({ command: { kind: "node-test" }, result }).passedTests, 27);
  assert.equal(checkFeedback({ command: { kind: "cargo-test" }, result }).passedTests, 0);
  assert.equal(checkFeedback({ command: { kind: "node-test" }, result: {} }).passedTests, null);
});
test("host output failure rejects the pending action and removes its stream listeners", async () => {
  const directory = mkdtempSync(join(tmpdir(), "oxigraph-workflow-test-"));
  const input = new PassThrough();
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(new Error("closed host output")); } });
  // The fixture prevents an unhandled stream error; the bridge must still
  // observe it and reject its own pending request, not wait for its timeout.
  output.on("error", () => {});
  const baseline = output.listenerCount("error");
  const bridge = stdioHost(directory, input, output);
  let timer;
  try {
    const pending = bridge.request({ requestId: 1, action: "mcp-read" });
    await assert.rejects(Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("bridge failed to report stream error")), 250);
    })]), /closed host output/);
  } finally {
    clearTimeout(timer);
    bridge.close();
    input.destroy();
    output.destroy();
    rmSync(directory, { recursive: true });
  }
  assert.equal(output.listenerCount("error"), baseline);
});
test("host input error is contained even when readline forwards it", () => {
  const directory = mkdtempSync(join(tmpdir(), "oxigraph-workflow-input-test-"));
  try {
    execFileSync(process.execPath, ["--input-type=module", "--eval", `
      import assert from 'node:assert/strict';
      import { PassThrough } from 'node:stream';
      import { stdioHost } from './tools/engineering-harness/src/workflow-host.mjs';
      const input = new PassThrough(); const output = new PassThrough();
      const bridge = stdioHost(process.argv[1], input, output);
      const pending = bridge.request({requestId: 1, action: 'mcp-read'});
      input.emit('error', new Error('input disconnected'));
      await assert.rejects(pending, /input disconnected/);
      bridge.close(); input.destroy(); output.destroy();
    `, directory], { timeout: 2000, stdio: "pipe" });
  } finally { rmSync(directory, { recursive: true }); }
});
