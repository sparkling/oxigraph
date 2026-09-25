import assert from "node:assert/strict";
import test from "node:test";
import { runWorkflow, validateWorkflow } from "../src/workflow.mjs";
import {
  ordinaryWorkflowPath as path,
  ordinaryWorkflowSpec as spec,
  setupOrdinaryWorkflowFixture as setup,
  updateNativeResults,
} from "./support/ordinary-workflow-fixture.mjs";

const contributor = (workerId) => ({
  client: "native-test-double",
  workerId,
  model: "cc/claude-opus-5",
  effort: "xhigh",
  paths: [path],
  sourceSha256: "a".repeat(64),
  reason: "Previously valid bounded contribution",
});

test("ordinary native prompts require one worker and forbid delegation", async () => {
  const fixtureState = setup();
  const instructions = new Map();
  const host = updateNativeResults(fixtureState, (result, request) => {
    instructions.set(request.payload.route.role, request.payload.instructions);
    result.contributors = [];
  });
  const result = await runWorkflow(spec, host, fixtureState.io);
  assert.deepEqual(result.implementationWorkerIds, ["implementation"]);
  for (const role of ["implement", "review"]) {
    assert.match(instructions.get(role), /Work alone/);
    assert.match(instructions.get(role), /Do not spawn subagents, contributors, child sessions, or independent native sessions/);
    assert.doesNotMatch(instructions.get(role), /no provider-wide session cap|may contribute bounded ready work/);
  }
});

test("implementation contributors fail before root application", async () => {
  const fixtureState = setup();
  const host = updateNativeResults(fixtureState, (result, request) => {
    if (request.payload.route.role === "implement") result.contributors = [contributor("implementation-child")];
  });
  await assert.rejects(runWorkflow(spec, host, fixtureState.io), /Active native contributors are disabled/);
  assert.ok(!fixtureState.actions.includes("root-apply"));
  assert.deepEqual(fixtureState.counters(), { checks: 0, implementations: 1, reviews: 0 });
});

test("review contributors fail before MCP handoff", async () => {
  const fixtureState = setup();
  const host = updateNativeResults(fixtureState, (result, request) => {
    if (request.payload.route.role === "review") result.contributors = [contributor("review-child")];
  });
  await assert.rejects(runWorkflow(spec, host, fixtureState.io), /Active native contributors are disabled/);
  assert.ok(fixtureState.actions.includes("root-apply"));
  assert.ok(!fixtureState.actions.includes("mcp-handoff"));
  assert.deepEqual(fixtureState.counters(), { checks: 1, implementations: 1, reviews: 1 });
});

test("single implementation worker remains excluded from review", async () => {
  const fixtureState = setup({ sameWorker: true });
  await assert.rejects(runWorkflow(spec, fixtureState.host, fixtureState.io), /Reviewer is not independent/);
  assert.ok(!fixtureState.actions.includes("mcp-handoff"));
});

test("spec role overrides reject Codex and unqualified models before any host request", async () => {
  for (const implement of [
    { model: "gpt-5.6-terra", effort: "medium", reason: "codex override" },
    { model: "gpt-6-astra", effort: "high", reason: "codex decision override" },
    { model: "claude-opus-5", effort: "xhigh", reason: "unqualified alias" },
    { model: "cc/claude-opus-5", effort: "ultra", reason: "owner", selection: "owner" },
    { model: "cc/claude-opus-5", effort: "max", reason: "unselected max" },
  ]) {
    assert.throws(() => validateWorkflow({ ...spec, implement }));
    const fixtureState = setup();
    await assert.rejects(runWorkflow({ ...spec, implement }, fixtureState.host, fixtureState.io));
    assert.deepEqual(fixtureState.actions, []);
    assert.deepEqual(fixtureState.counters(), { checks: 0, implementations: 0, reviews: 0 });
  }
  assert.doesNotThrow(() => validateWorkflow({ ...spec,
    implement: { model: "cc/claude-sonnet-5", effort: "high", reason: "bounded harness edit" },
    review: { model: "cc/claude-opus-5", effort: "max", reason: "owner-selected review", selection: "owner" },
  }));
});

test("native stages retain gateway-qualified role defaults", async () => {
  const fixtureState = setup();
  const routes = [];
  const host = updateNativeResults(fixtureState, (_result, request) => routes.push(request.payload.route));
  const result = await runWorkflow(spec, host, fixtureState.io);
  assert.equal(result.status, "ready-for-owner-review");
  assert.deepEqual(routes.map(({ role, model, effort }) => [role, model, effort]), [
    ["implement", "cc/claude-opus-5", "xhigh"],
    ["review", "cc/claude-opus-5", "high"],
  ]);
});

test("harness scope admits only the exact ordinary policy split paths", () => {
  for (const admitted of [
    "tools/engineering-harness/README.md",
    "tools/engineering-harness/test/workflow-policy.test.mjs",
    "tools/engineering-harness/test/support/ordinary-workflow-fixture.mjs",
  ]) assert.doesNotThrow(() => validateWorkflow({ ...spec, paths: [admitted] }));
  for (const rejected of [
    "tools/engineering-harness/README-copy.md",
    "tools/engineering-harness/test/workflow-policy-copy.test.mjs",
    "tools/engineering-harness/test/support/ordinary-workflow-fixture-copy.mjs",
  ]) assert.throws(() => validateWorkflow({ ...spec, paths: [rejected] }));
});
