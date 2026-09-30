import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { coordinatorLaunch, coordinatorPrompt, startCoordinator } from "../src/ordinary-coordinator.mjs";
import { routeDelivery } from "../src/delivery.mjs";

const session = "11111111-2222-3333-4444-555555555555";
const cli = "tools/engineering-harness/bin/oxigraph-delivery.mjs";
test("coordinator ordinary instructions match configured default routes and retain repair/pins", () => {
  for (const role of ["plan", "implement", "documentation", "review"]) {
    const route = routeDelivery({ role, taskId: "task-coordinator-routing", completionCheck: "reviewed result" });
    assert.ok(coordinatorPrompt.includes(`${route.model}/${route.effort}`), role);
    assert.equal(route.transport, "native-subscription");
  }
  assert.ok(coordinatorPrompt.includes("Opus repair and stronger explicit task pins"));
  assert.ok(coordinatorPrompt.includes("Historical routes and receipts remain unchanged"));
  assert.ok(!coordinatorPrompt.includes("Preserve Sonnet 5.5 ordinary"));
});
test("coordinator preview pins existing resume and native model without spawning", () => {
  const launch = JSON.parse(execFileSync(process.execPath, [cli, "coordinator", "--session", session], { encoding: "utf8" }));
  assert.equal(launch.executionStarted, false);
  assert.deepEqual(launch.args, ["resume", session, "--yolo", "--model", "gpt-6-astra", "--config",
    'model_reasoning_effort="medium"', "--config", 'plan_mode_reasoning_effort="medium"', coordinatorPrompt]);
  assert.ok(launch.notChecked.includes("exclusive integration ownership"));
  for (const args of [[], ["--session", "invalid"], ["--session", session, "--start", "false"],
    ["--session", session, "--model", "other"], ["--session", session, "--", "extra"]]) {
    assert.throws(() => execFileSync(process.execPath, [cli, "coordinator", ...args], { stdio: "pipe" }));
  }
});
test("explicit start reuses canonical guard and exact native launch with inherited transport", () => {
  const calls = [];
  const code = startCoordinator(session, { observe: () => calls.push("guard"), spawn: (command, args, options) => {
    calls.push("spawn"); assert.equal(command, "codex");
    assert.deepEqual(args, coordinatorLaunch(session).args);
    assert.deepEqual(options, { cwd: coordinatorLaunch(session).cwd, stdio: "inherit" });
    return { status: 7 };
  } });
  assert.equal(code, 7); assert.deepEqual(calls, ["guard", "spawn"]);
  assert.throws(() => startCoordinator(session, { observe: () => { throw new Error("not main"); },
    spawn: () => assert.fail("must not launch") }), /not main/);
  assert.throws(() => startCoordinator(session, { observe: () => {},
    spawn: () => ({ error: new Error("ENOENT") }) }), /codex gpt-6-astra: ENOENT/);
});
test("native coordinator contract retains ready-only batching, acceptance gating and refill", () => {
  for (const phrase of ["batch --spec", "complete read dependencies", "pending-owner-acceptance",
    "Do not wait for unrelated snapshot-bound siblings", "Revalidate every candidate", "accepted parent source reaches main",
    "refill through the same batch", "unconfirmed external actions keep ownership", "historical WIP",
    'nativeChildEnvironment("claude")', "CLAUDE_CODE_MAX_OUTPUT_TOKENS", "128000", "client/model clamp applies"]) {
    assert.ok(coordinatorPrompt.includes(phrase), phrase);
  }
  assert.ok(!coordinatorPrompt.includes("drain current batch"));
  for (const phrase of ["assertOwnerActionIndependent", "Unknown reads/actions retain the hold",
    "Never integrate inside awaited onSettled", "whole authorized frontier", "Explicit user pause wins",
    "Status or handoff answers do not pause", "never label an unserviced or stopped loop active"]) {
    assert.ok(coordinatorPrompt.includes(phrase), phrase);
  }
});
